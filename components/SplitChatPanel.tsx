"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Mic, Plus, Sparkles, CheckCircle, FileText, Trash2, Edit2, GripVertical, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ChatMessage, ProductSuggestion, QuotePreview, ChargeConfig } from "@/types/database";
import { trackAIChatMessage } from "@/lib/analytics";
import toast from "react-hot-toast";
import { useCurrentUser, getCurrentUserClient, getAnonymousUser, type UserRef } from "@/lib/auth/client";
import { generateStableKey } from "@/lib/stableKey";

interface SplitChatPanelProps {
  projectId: string;
  projectName: string;
}

type TabType = "suggested" | "preview";

export default function SplitChatPanel({ projectId, projectName }: SplitChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("suggested");
  const [suggestedProducts, setSuggestedProducts] = useState<ProductSuggestion[]>([]);
  const [quotePreview, setQuotePreview] = useState<QuotePreview | null>(null);
  const [showSplitView, setShowSplitView] = useState(false);
  const [applyingChanges, setApplyingChanges] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [editingQuantityIndex, setEditingQuantityIndex] = useState<number | null>(null);
  const [tempQuantity, setTempQuantity] = useState("");
  const [editingDiscountIndex, setEditingDiscountIndex] = useState<number | null>(null);
  const [tempDiscount, setTempDiscount] = useState("");
  const [showChargeConfig, setShowChargeConfig] = useState(false);
  const [currentCharge, setCurrentCharge] = useState<{
    name: string;
    rate: string;
    appliesTo: 'all' | 'exclude_products';
    selectedProducts: string[];
  }>({
    name: 'Sales Tax',
    rate: '',
    appliesTo: 'all',
    selectedProducts: []
  });
  const [showMarkupConfig, setShowMarkupConfig] = useState(false);
  const [editingMarkupId, setEditingMarkupId] = useState<string | null>(null); // Track if we're editing an existing markup
  const [currentMarkup, setCurrentMarkup] = useState<{
    name: string;
    rate: string;
    lumpSum: string;
    baseAppliesTo: 'all' | 'exclude_products';
    baseSelectedProducts: string[];
    addToAppliesTo: 'all' | 'exclude_products';
    addToSelectedProducts: string[];
    distribution: 'proportional' | 'even' | 'single';
    singleItemIndex: number | null;
    showAdvanced: boolean;
  }>({
    name: 'Markup',
    rate: '',
    lumpSum: '',
    baseAppliesTo: 'all',
    baseSelectedProducts: [],
    addToAppliesTo: 'all',
    addToSelectedProducts: [],
    distribution: 'proportional',
    singleItemIndex: null,
    showAdvanced: false
  });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [lastSentMessage, setLastSentMessage] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [editQuoteId, setEditQuoteId] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [editQuoteName, setEditQuoteName] = useState<string | null>(null);
  const [changeNotes, setChangeNotes] = useState("");
  const [showChangeNotes, setShowChangeNotes] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentProjectId = useRef<string | null>(null);
  const hasLoadedMessages = useRef(false);
  const isClearing = useRef(false); // Track if we're in the middle of clearing
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null); // Track current fetch request
  const stoppedMessageTimestamp = useRef<string | null>(null); // Track when we stopped a message
  const orphanCleanupIntervalRef = useRef<NodeJS.Timeout | null>(null); // Global cleanup interval
  const currentRunIdRef = useRef<string | null>(null); // Track current run ID for validation
  const currentPoolIdRef = useRef<string | null>(null); // Track current pool ID for product isolation
  const supabase = createClient();
  const currentUser = useCurrentUser(); // Get current authenticated user

  // Global orphan cleanup that survives component lifecycle
  useEffect(() => {
    // Start a global interval that checks for orphaned messages every 3 seconds
    // This survives component unmounting
    if (!orphanCleanupIntervalRef.current) {
      console.log('🚀 Starting global orphan cleanup interval');
      
      orphanCleanupIntervalRef.current = setInterval(async () => {
        try {
          const stoppedMessages = JSON.parse(localStorage.getItem('stoppedMessages') || '{}');
          
          // Check each project that has a stopped message
          for (const [projId, timestamp] of Object.entries(stoppedMessages)) {
            console.log(`🔍 Global cleanup checking project ${projId} for orphans after ${timestamp}`);
            
            const { data: orphanedMessages } = await supabase
              .from("chat_messages")
              .select("id, role, created_at")
              .eq("project_id", projId)
              .gt("created_at", timestamp as string);
            
            if (orphanedMessages && orphanedMessages.length > 0) {
              console.log(`🧹 Global cleanup found ${orphanedMessages.length} orphaned messages in project ${projId}, deleting...`);
              
              const orphanedIds = orphanedMessages.map(m => m.id);
              
              // Delete orphaned messages
              await supabase
                .from("chat_messages")
                .delete()
                .in("id", orphanedIds);
              
              // Delete working state
              await supabase
                .from("project_working_state")
                .delete()
                .eq("project_id", projId);
              
              // Update UI if we're currently viewing this project
              if (currentProjectId.current === projId) {
                setMessages(prev => prev.filter(m => !orphanedIds.includes(m.id)));
                setSuggestedProducts([]);
                setQuotePreview(null);
              }
              
              console.log(`✅ Global cleanup deleted ${orphanedMessages.length} orphaned messages`);
              
              // Remove from localStorage after successful cleanup
              const updatedStopped = JSON.parse(localStorage.getItem('stoppedMessages') || '{}');
              delete updatedStopped[projId];
              localStorage.setItem('stoppedMessages', JSON.stringify(updatedStopped));
            }
          }
        } catch (error) {
          console.error('Global cleanup error:', error);
        }
      }, 3000); // Check every 3 seconds
    }
    
    return () => {
      // Don't clear the interval on unmount - we want it to keep running globally
      // It will only be cleared when the entire app unmounts
    };
  }, []); // Empty dependency array - run once on mount

  // Load working state from database
  async function loadWorkingState() {
    try {
      const { data, error } = await supabase
        .from("project_working_state")
        .select("*")
        .eq("project_id", projectId)
        .single();

      if (error) {
        // If no working state exists, that's fine - user is starting fresh
        if (error.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error('Error loading working state:', error);
        }
        return null;
      }

      if (data) {
        console.log('Loaded working state from database');
        
        // Load suggested products if they're recent (from background generation)
        // Check if products are from the last 30 minutes
        const storedPoolId = data.current_pool_id;
        const suggestedProducts = data.suggested_products || [];
        const updatedAt = data.updated_at ? new Date(data.updated_at) : null;
        const now = new Date();
        const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
        
        const isRecent = updatedAt && updatedAt > thirtyMinutesAgo;
        
        if (suggestedProducts.length > 0 && storedPoolId) {
          if (isRecent) {
            console.log(`✅ [Background] Loading ${suggestedProducts.length} products from poolId "${storedPoolId}" (updated ${updatedAt?.toISOString()})`);
            setSuggestedProducts(suggestedProducts);
            setShowSplitView(true);
            // Auto-switch to suggested products tab
            setActiveTab("suggested");
          } else {
            console.warn(`🚫 Context Guard: Blocking ${suggestedProducts.length} stale products from poolId "${storedPoolId}". Products are older than 30 minutes.`);
            console.log(`🧹 suggest:cleared { projectId: "${projectId}", reason: "stale from previous session", stalePoolId: "${storedPoolId}" }`);
            setSuggestedProducts([]); // Clear stale suggestions
          }
        } else {
          setSuggestedProducts([]); // No products to load
        }
        
        setQuotePreview(normalizeQuotePreview(data.quote_preview as QuotePreview | null));
        setShowSplitView(data.show_split_view || false);
        
        return data;
      }
      return null;
    } catch (error) {
      console.error('Failed to load working state:', error);
      return null;
    }
  }

  // Save working state to database
  async function saveWorkingState() {
    try {
      const workingState = {
        project_id: projectId,
        suggested_products: suggestedProducts,
        quote_preview: quotePreview,
        show_split_view: showSplitView
      };

      const { error } = await supabase
        .from("project_working_state")
        .upsert(workingState, { onConflict: 'project_id' });

      if (error) {
        console.error('Error saving working state:', error);
      } else {
        console.log('Working state saved to database');
      }
    } catch (error) {
      console.error('Failed to save working state:', error);
    }
  }

  // Auto-save working state whenever it changes
  useEffect(() => {
    // Only save if we have loaded messages (avoid saving during initial load)
    if (hasLoadedMessages.current && currentProjectId.current === projectId) {
      const timeoutId = setTimeout(() => {
        saveWorkingState();
      }, 500); // Debounce by 500ms to avoid too many saves

      return () => clearTimeout(timeoutId);
    }
  }, [suggestedProducts, quotePreview, showSplitView]);

  // Poll for new messages (handles background task completion)
  useEffect(() => {
    let isActive = true;
    
    const pollForNewMessages = async () => {
      try {
        // Only poll if we're actively viewing this project and messages have loaded
        if (!hasLoadedMessages.current || currentProjectId.current !== projectId) {
          return;
        }

        // Get the ID of the most recent message we have
        const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
        
        // Check for messages newer than our last message
        const query = supabase
          .from("chat_messages")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });
        
        if (lastMessageId) {
          // Get messages created after our last message
          query.gt("created_at", messages[messages.length - 1].created_at);
        }
        
        const { data: newMessages, error } = await query;

        if (!isActive || error) return;

        // If we found new messages, add them to the state
        if (newMessages && newMessages.length > 0) {
          console.log(`📨 Polling found ${newMessages.length} new message(s)`);
          setMessages(prev => [...prev, ...newMessages]);
          
          // If there's a new assistant message, turn off loading state and reload working state
          const hasNewAssistantMessage = newMessages.some(m => m.role === 'assistant');
          if (hasNewAssistantMessage) {
            if (loading) {
              setLoading(false);
            }
            // Reload working state to get any products that were saved by background task
            console.log('🔄 Reloading working state after background task completion');
            await loadWorkingState();
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // Start polling when component mounts and messages are loaded
    if (hasLoadedMessages.current && currentProjectId.current === projectId) {
      // Poll every 2 seconds for responsive updates
      pollingIntervalRef.current = setInterval(pollForNewMessages, 2000);
      
      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        isActive = false;
      };
    }
  }, [projectId, messages, loading, hasLoadedMessages.current]);

  useEffect(() => {
    let isActive = true;
    
    // Always load messages and working state when projectId changes
    const loadProjectData = async () => {
      try {
        // Don't load if we're in the middle of clearing
        if (isClearing.current) {
          console.log('⏸️ Skipping load - clear operation in progress');
          return;
        }

        // Check if we've already loaded data for this project in this effect
        const previousProjectId = currentProjectId.current;
        if (previousProjectId === projectId && hasLoadedMessages.current) {
          console.log('✓ Project data already loaded, skipping');
          return;
        }

        // Update tracking refs
        currentProjectId.current = projectId;
        hasLoadedMessages.current = false;
        
        console.log('📥 Loading project data for:', projectId);
        console.log('🔄 Previous project was:', previousProjectId);
        
        // Reset loading state when switching projects
        setLoading(false);
        
        // Show welcome message immediately (optimistic UI)
        const welcomeMessage: ChatMessage = {
          id: 'temp-welcome-' + Date.now(),
          project_id: projectId,
          role: 'assistant',
          content: `Welcome to the ${projectName} project! I'm here to help you create a professional quote.\n\nTo get started, please describe the scope of work for this project. What services or products does the client need?`,
          metadata: {},
          created_at: new Date().toISOString()
        };
        setMessages([welcomeMessage]);
        
        // Reset state temporarily while loading
        setShowSplitView(false);
        setSuggestedProducts([]);
        setQuotePreview(null);
        
        // Small delay to ensure any pending deletes have completed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Load messages from database (with cache busting)
        const { data: messagesData, error: messagesError } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .limit(100);

        if (!isActive) return;

        if (messagesError) {
          console.error('Chat load error:', messagesError);
          await sendSystemMessageToDb(welcomeMessage.content);
          hasLoadedMessages.current = true;
          return;
        }

        if (messagesData && messagesData.length > 0) {
          console.log(`📨 Loaded ${messagesData.length} messages from database for project ${projectId}`);
          console.log('📋 Message IDs:', messagesData.map(m => m.id));
          console.log('📝 Message previews:', messagesData.map(m => m.content.substring(0, 50) + '...'));
          
          // Aggressive cleanup: Check for orphaned messages from stopped generations
          const stoppedMessages = JSON.parse(localStorage.getItem('stoppedMessages') || '{}');
          const stoppedTimestamp = stoppedMessages[projectId];
          
          let filteredMessages = messagesData;
          
          if (stoppedTimestamp) {
            console.log('🔍 Found stopped message timestamp, checking for orphans...', stoppedTimestamp);
            
            // Find any messages created after the stopped timestamp
            const orphanedMessages = messagesData.filter(m => m.created_at > stoppedTimestamp);
            
            if (orphanedMessages.length > 0) {
              console.log(`🧹 Found ${orphanedMessages.length} orphaned message(s), deleting...`);
              
              // Delete from database
              const orphanedIds = orphanedMessages.map(m => m.id);
              await supabase
                .from("chat_messages")
                .delete()
                .in("id", orphanedIds);
              
              // Filter out orphaned messages from the loaded data
              filteredMessages = messagesData.filter(m => !orphanedIds.includes(m.id));
              
              // Also clear working state (suggested products) from the stopped generation
              await supabase
                .from("project_working_state")
                .delete()
                .eq("project_id", projectId);
              
              console.log('✅ Orphaned messages and working state cleaned up');
            }
            
            // Clear the stopped timestamp from localStorage ONLY after cleanup
            delete stoppedMessages[projectId];
            localStorage.setItem('stoppedMessages', JSON.stringify(stoppedMessages));
            stoppedMessageTimestamp.current = null;
          }
          
          // Additional safety check: Look for conversation anomalies even without localStorage
          // Check if last message is a user message with recent messages after it
          if (filteredMessages.length > 0) {
            const lastMessage = filteredMessages[filteredMessages.length - 1];
            
            // If last message is from user, check for any messages created after it
            if (lastMessage.role === 'user') {
              console.log('🔍 Last message is from user, checking for orphaned responses...');
              
              const { data: potentialOrphans } = await supabase
                .from("chat_messages")
                .select("id, role, created_at")
                .eq("project_id", projectId)
                .gt("created_at", lastMessage.created_at);
              
              if (potentialOrphans && potentialOrphans.length > 0) {
                console.log(`🧹 Found ${potentialOrphans.length} messages after last user message, deleting as orphans...`);
                
                const orphanIds = potentialOrphans.map(m => m.id);
                await supabase
                  .from("chat_messages")
                  .delete()
                  .in("id", orphanIds);
                
                await supabase
                  .from("project_working_state")
                  .delete()
                  .eq("project_id", projectId);
                
                // Store timestamp for global cleanup
                const stoppedMessages = JSON.parse(localStorage.getItem('stoppedMessages') || '{}');
                stoppedMessages[projectId] = lastMessage.created_at;
                localStorage.setItem('stoppedMessages', JSON.stringify(stoppedMessages));
                
                console.log('✅ Orphaned messages after user message deleted');
              }
            }
            
            // Check for conversation anomalies (consecutive user messages)
            for (let i = 1; i < filteredMessages.length; i++) {
              if (filteredMessages[i].role === 'user' && filteredMessages[i-1].role === 'user') {
                console.warn('⚠️ Detected conversation anomaly: consecutive user messages');
                // Keep the earlier user message timestamp in localStorage for monitoring
                const stoppedMessages = JSON.parse(localStorage.getItem('stoppedMessages') || '{}');
                stoppedMessages[projectId] = filteredMessages[i-1].created_at;
                localStorage.setItem('stoppedMessages', JSON.stringify(stoppedMessages));
                break;
              }
            }
          }
          
          setMessages(filteredMessages);
          hasLoadedMessages.current = true;
          
          // Check if there's an unanswered user message (task still running in background)
          const lastMessage = filteredMessages[filteredMessages.length - 1];
          if (lastMessage && lastMessage.role === 'user') {
            console.log('⏳ Detected unanswered user message - task may still be running');
            // We'll check the working state next to see if task completed
            setLoading(true); // Show loading indicator (may be turned off if products exist)
          } else {
            console.log('✓ Last message is from assistant - task completed');
            setLoading(false); // Ensure loading is off
          }
        } else {
          console.log('📭 No existing messages, persisting welcome message');
          await sendSystemMessageToDb(welcomeMessage.content);
          hasLoadedMessages.current = true;
        }

        // Load working state (suggested products and preview)
        const workingStateData = await loadWorkingState();
        
        // If working state has products, the background task completed - turn off loading
        if (workingStateData?.suggested_products && workingStateData.suggested_products.length > 0) {
          console.log('✅ Working state has products - background task completed');
          setLoading(false);
        }
        
      } catch (error: any) {
        console.error('Project data load error:', error);
        const welcomeMessage: ChatMessage = {
          id: 'temp-welcome-' + Date.now(),
          project_id: projectId,
          role: 'assistant',
          content: `Welcome to the ${projectName} project! I'm here to help you create a professional quote.\n\nTo get started, please describe the scope of work for this project. What services or products does the client need?`,
          metadata: {},
          created_at: new Date().toISOString()
        };
        await sendSystemMessageToDb(welcomeMessage.content);
      }
    };
    
    loadProjectData();
    
    return () => {
      isActive = false;
      // DON'T abort ongoing AI requests when switching projects
      // Let them complete in the background so results are ready when user returns
      // The validation checks (projectId, runId, poolId) will prevent stale data from being applied
      console.log('[Background] Allowing AI generation to continue for project:', projectId);
      // Reset loading state when switching away from this project
      setLoading(false);
    };
  }, [projectId, projectName]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea as user types
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '20px';
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
    }
  }, [input]);

  // Listen for edit quote events
  useEffect(() => {
    const handleEditQuoteStarted = async (event: CustomEvent) => {
      const { quoteId, sessionId, version, quoteName } = event.detail;
      
      console.log('[EditMode] Quote edit started:', { quoteId, sessionId, version, quoteName });
      console.log('[EditUI] ui:edit:enter { quoteId:', quoteId, ', version:', version, ', session:', sessionId, '}');
      
      setEditMode(true);
      setEditSessionId(sessionId);
      setEditQuoteId(quoteId);
      setEditVersion(version);
      setEditQuoteName(quoteName);
      setChangeNotes("");
      setShowChangeNotes(false);
      
      // Load the quote preview from working state
      const workingState = await loadWorkingState();
      if (workingState && workingState.quote_preview) {
        console.log('[EditMode] Working state loaded:', {
          hasQuotePreview: !!workingState.quote_preview,
          lineItemCount: workingState.quote_preview?.line_items?.length || 0,
          lineItems: workingState.quote_preview?.line_items?.map((i: any) => ({ name: i.product_name, qty: i.quantity })) || []
        });
        
        setQuotePreview(normalizeQuotePreview(workingState.quote_preview as QuotePreview | null));
        setShowSplitView(true);
        setActiveTab("preview");
        
        // Clear suggestions in edit mode (they're ephemeral)
        setSuggestedProducts([]);
        
        // Telemetry for rehydrated baked markups
        const markupCount = workingState.quote_preview?.bakedMarkups?.length || 0;
        if (markupCount > 0) {
          console.log('[Telemetry] rehydrate:bakedMarkups { count:', markupCount, '}');
          console.log('[EditMode] Rehydrated', markupCount, 'baked markup(s)');
        }
        
        console.log('[EditMode] Quote rehydrated into preview');
        
        // Show non-sticky toast notification
        toast(
          <div className="flex flex-col gap-1">
            <div className="font-medium">✏️ Edit mode enabled</div>
            <div className="text-sm text-gray-600">
              Make changes via chat. Submitting will create v{version + 1}.
            </div>
          </div>,
          { 
            duration: 4000,
            position: 'top-center',
            style: {
              background: '#FEF3C7',
              color: '#92400E',
              border: '1px solid #FCD34D'
            }
          }
        );
      }
    };

    window.addEventListener('editQuoteStarted' as any, handleEditQuoteStarted);
    
    return () => {
      window.removeEventListener('editQuoteStarted' as any, handleEditQuoteStarted);
    };
  }, []);

  // Listen for new quote started event
  useEffect(() => {
    const handleNewQuoteStarted = async (event: CustomEvent) => {
      const { quoteName } = event.detail;
      
      console.log('[NewQuote] Starting new quote:', quoteName);
      
      try {
        // Set clearing flag to prevent race conditions
        isClearing.current = true;

        // Clear chat messages from database
        await supabase
          .from("chat_messages")
          .delete()
          .eq("project_id", projectId);

        // Clear working state from database
        await supabase
          .from("project_working_state")
          .delete()
          .eq("project_id", projectId);

        // Wait a moment to ensure deletes are committed
        await new Promise(resolve => setTimeout(resolve, 300));

        // Reset all state
        setMessages([]);
        setSuggestedProducts([]);
        setQuotePreview(null);
        setShowSplitView(false);
        setSelectAll(false);
        setApplyingChanges(false);
        setActiveTab("suggested");

        // Reset edit mode if active
        if (editMode) {
          setEditMode(false);
          setEditSessionId(null);
          setEditQuoteId(null);
          setEditVersion(null);
          setEditQuoteName(null);
        }

        console.log("✅ Chat cleared for new quote:", quoteName);
        isClearing.current = false;

      } catch (error) {
        console.error("Error clearing chat for new quote:", error);
        toast.error("Failed to clear chat");
        isClearing.current = false;
      }
    };

    window.addEventListener('newQuoteStarted' as any, handleNewQuoteStarted);
    
    return () => {
      window.removeEventListener('newQuoteStarted' as any, handleNewQuoteStarted);
    };
  }, [projectId, editMode]);

  // Check if we're in edit mode on mount
  useEffect(() => {
    async function checkEditMode() {
      const { isProjectInEditMode } = await import("@/lib/editSessionController");
      const editStatus = await isProjectInEditMode(projectId);
      
      if (editStatus.isEditing && editStatus.sessionId) {
        console.log('[EditMode] Resuming edit session:', editStatus.sessionId);
        setEditMode(true);
        setEditSessionId(editStatus.sessionId);
        setEditQuoteId(editStatus.quoteId);
        
        // Load quote info from database
        const { data: quote } = await supabase
          .from("quotes")
          .select("version_number, quote_name")
          .eq("id", editStatus.quoteId)
          .single();
        
        if (quote) {
          setEditVersion(quote.version_number);
          setEditQuoteName(quote.quote_name);
        }
      }
    }
    
    checkEditMode();
  }, [projectId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  async function sendSystemMessageToDb(content: string) {
    const systemMsg: Partial<ChatMessage> = {
      project_id: projectId,
      role: "assistant",
      content,
      metadata: {},
    };

    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert(systemMsg)
        .select()
        .single();

      if (!error && data) {
        setMessages([data]);
      }
    } catch (error) {
      console.error('Failed to persist welcome message:', error);
    }
  }

  // Toggle product selection
  function toggleProductSelection(productId: string) {
    setSuggestedProducts(prev =>
      prev.map(p => p.id === productId ? { ...p, selected: !p.selected } : p)
    );
  }

  // Toggle select all
  function toggleSelectAll() {
    const newSelectAll = !selectAll;
    setSelectAll(newSelectAll);
    setSuggestedProducts(prev =>
      prev.map(p => ({ ...p, selected: newSelectAll }))
    );
  }

  // Get count of selected products
  const selectedCount = suggestedProducts.filter(p => p.selected).length;

  // Format number with commas
  function formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  }

  async function applyChangesToQuote() {
    const selectedProducts = suggestedProducts.filter(p => p.selected);
    
    if (selectedProducts.length === 0) {
      toast.error("Please select at least one product");
      return;
    }

    setApplyingChanges(true);
    try {
      const selectedPoolId = selectedProducts[0]?.poolId || currentPoolIdRef.current;
      
      // Get existing preview items or start fresh
      const existingItems = quotePreview?.line_items || [];
      
      // CRITICAL: Deterministic replacement with deduplication
      // When adding products to quote preview, deduplicate by canonical key
      const allItems = [...existingItems, ...selectedProducts];
      
      // Deduplicate by canonical key (product name)
      const seen = new Map();
      const dedupedItems = [];
      const droppedDuplicates = [];
      
      for (const item of allItems) {
        const canonicalKey = item.canonicalKey || item.product_name?.toLowerCase().trim();
        if (seen.has(canonicalKey)) {
          droppedDuplicates.push(item.product_name);
          console.log(`🏊 pool:dedupe { poolId: "${selectedPoolId}", dropped: ["${item.product_name}"], reason: "duplicate in quote preview" }`);
        } else {
          seen.set(canonicalKey, true);
          dedupedItems.push(item);
        }
      }
      
      const preview = buildQuotePreviewUpdate(dedupedItems, quotePreview);
      setQuotePreview(preview);
      
      // Log the replacement operation
      const selectedNames = selectedProducts.map(p => p.product_name);
      console.log(`🏊 pool:replace { poolId: "${selectedPoolId}", added: ${JSON.stringify(selectedNames)}, dedupedCount: ${droppedDuplicates.length} }`);
      
      // Remove selected products from suggested list, keep unselected ones
      setSuggestedProducts(prev => prev.filter(p => !p.selected));
      setSelectAll(false);
      
      setActiveTab("preview");
      const successMsg = droppedDuplicates.length > 0 
        ? `Added ${selectedProducts.length} product(s) (${droppedDuplicates.length} duplicate(s) removed)`
        : `Added ${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''} to quote!`;
      toast.success(successMsg);
    } catch (error) {
      toast.error("Failed to update preview");
    } finally {
      setApplyingChanges(false);
    }
  }

  // Delete a preview product
  function deletePreviewProduct(index: number) {
    if (!quotePreview) return;
    
    const updatedItems = quotePreview.line_items.filter((_, i) => i !== index);
    
    if (updatedItems.length === 0) {
      setQuotePreview(null);
      toast.success("Product removed from preview");
      return;
    }
    
    const updatedPreview = buildQuotePreviewUpdate(updatedItems, quotePreview);
    setQuotePreview(updatedPreview);
    
    toast.success("Product removed from preview");
  }

  // Start editing quantity
  function startEditingQuantity(index: number, currentQuantity: number) {
    setEditingQuantityIndex(index);
    setTempQuantity(String(currentQuantity));
  }

  // Save edited quantity
  function saveEditedQuantity(index: number) {
    const newQuantity = parseFloat(tempQuantity);
    
    if (isNaN(newQuantity) || newQuantity < 0.01) {
      toast.error("Please enter a valid quantity");
      return;
    }
    
    editPreviewProductQuantity(index, newQuantity);
    setEditingQuantityIndex(null);
    setTempQuantity("");
    toast.success("Quantity updated");
  }

  // Cancel editing quantity
  function cancelEditingQuantity() {
    setEditingQuantityIndex(null);
    setTempQuantity("");
  }

  // Start editing discount
  function startEditingDiscount(index: number, currentDiscount: number) {
    setEditingDiscountIndex(index);
    setTempDiscount(String((currentDiscount || 0) * 100)); // Convert to percentage
  }

  // Save edited discount
  function saveEditedDiscount(index: number) {
    const newDiscountPercent = parseFloat(tempDiscount);
    
    if (isNaN(newDiscountPercent) || newDiscountPercent < 0 || newDiscountPercent > 100) {
      toast.error("Please enter a valid discount (0-100%)");
      return;
    }
    
    editPreviewProductDiscount(index, newDiscountPercent / 100); // Convert to decimal
    setEditingDiscountIndex(null);
    setTempDiscount("");
    toast.success("Discount updated");
  }

  // Cancel editing discount
  function cancelEditingDiscount() {
    setEditingDiscountIndex(null);
    setTempDiscount("");
  }

  // Edit discount for a preview product
  function editPreviewProductDiscount(index: number, discountDecimal: number) {
    if (!quotePreview) return;
    
    const updatedItems = [...quotePreview.line_items];
    updatedItems[index].discount_percent = discountDecimal;
    
    // Recalculate line total with discount
    const originalTotal = updatedItems[index].unit_price * updatedItems[index].quantity;
    updatedItems[index].line_total = originalTotal * (1 - discountDecimal);
    
    const updatedPreview = buildQuotePreviewUpdate(updatedItems, quotePreview);
    setQuotePreview(updatedPreview);
  }

  // Calculate charge preview
  function calculateChargePreview() {
    if (!quotePreview) return { count: 0, total: 0 };
    
    const applicableItems = quotePreview.line_items.filter(item => {
      if (currentCharge.appliesTo === 'all') {
        return true;
      } else if (currentCharge.appliesTo === 'exclude_products') {
        return !currentCharge.selectedProducts.includes(item.product_name);
      }
      return false;
    });
    
    const total = applicableItems.reduce((sum, item) => sum + item.line_total, 0);
    return { count: applicableItems.length, total };
  }

  // Add charge to quote
  function addChargeToQuote() {
    if (!quotePreview) return;
    
    const rateDecimal = parseFloat(currentCharge.rate) / 100;
    if (isNaN(rateDecimal) || rateDecimal < 0) {
      toast.error("Please enter a valid percentage");
      return;
    }
    
    const preview = calculateChargePreview();
    const chargeAmount = preview.total * rateDecimal;
    
    const newCharge: ChargeConfig = {
      id: `charge-${Date.now()}`,
      name: currentCharge.name,
      rate: rateDecimal,
      applies_to: currentCharge.appliesTo,
      excluded_products: currentCharge.selectedProducts.length > 0 ? currentCharge.selectedProducts : undefined,
      calculated_amount: chargeAmount,
      applies_to_count: preview.count,
      applies_to_total: preview.total
    };
    
    const charges = [...(quotePreview.charges || []), newCharge];
    const updatedPreview = buildQuotePreviewUpdate(quotePreview.line_items, quotePreview, { charges });
    setQuotePreview(updatedPreview);
    
    // Reset form
    setCurrentCharge({
      name: 'Sales Tax',
      rate: '',
      appliesTo: 'all',
      selectedProducts: []
    });
    setShowChargeConfig(false);
    toast.success("Charge added");
  }

  // Remove charge
  function removeCharge(chargeId: string) {
    if (!quotePreview) return;
    
    const charges = (quotePreview.charges || []).filter(c => c.id !== chargeId);
    const updatedPreview = buildQuotePreviewUpdate(quotePreview.line_items, quotePreview, { charges });
    setQuotePreview(updatedPreview);
    
    toast.success("Charge removed");
  }

  // Edit baked markup - pre-fill modal with existing values
  function editBakedMarkup(markupId: string) {
    if (!quotePreview) return;
    
    const markup = quotePreview.bakedMarkups?.find(m => m.id === markupId);
    if (!markup) {
      toast.error("Markup not found");
      return;
    }
    
    console.log('[Markup] edit:open { markupId:', markupId, ', label:', markup.label, ', percent:', markup.percent, ', mode:', markup.calculationMode, ', lumpSum:', markup.lumpSumAmount, '}');
    
    const isLumpSumMarkup = (markup.calculationMode === 'amount') || (!!markup.lumpSumAmount && markup.lumpSumAmount > 0);
    
    // Convert stored markup config back to form state
    setCurrentMarkup({
      name: markup.label,
      rate: isLumpSumMarkup ? '' : (((markup.percent || 0) * 100).toString()),
      lumpSum: isLumpSumMarkup
        ? (markup.lumpSumAmount ?? markup.audited?.totalMarkup ?? 0).toString()
        : '',
      baseAppliesTo: markup.baseSelector.include === 'all' ? 'all' : 'exclude_products',
      baseSelectedProducts: markup.baseSelector.exclude || [],
      addToAppliesTo: markup.addToSelector.include === 'all' ? 'all' : 'exclude_products',
      addToSelectedProducts: markup.addToSelector.exclude || [],
      distribution: typeof markup.distribution === 'string' ? markup.distribution : 'proportional',
      singleItemIndex: typeof markup.distribution === 'object' && 'singleItemId' in markup.distribution 
        ? (quotePreview.line_items.findIndex(item => item.id === (markup.distribution as any).singleItemId) || 0)
        : null,
      showAdvanced: true // Show advanced when editing
    });
    
    setEditingMarkupId(markupId);
    setShowMarkupConfig(true);
  }

  // Remove baked markup - subtract deltas and remove rule
  function removeBakedMarkup(markupId: string) {
    if (!quotePreview) return;
    
    const markup = quotePreview.bakedMarkups?.find(m => m.id === markupId);
    if (!markup) {
      toast.error("Markup not found");
      return;
    }
    
    console.log('[Markup] delete:start { markupId:', markupId, ', totalMarkup:', markup.audited?.totalMarkup || 0, '}');
    console.log('[Telemetry] markup:delete { markupId:', markupId, ', totalDelta:', markup.audited?.totalMarkup || 0, '}');
    
    const perItemBaseBefore = markup.audited?.perItemBaseBefore || {};
    
    // Recompute items from baseline (don't subtract - recompute for accuracy)
    const updatedItems = quotePreview.line_items.map((item, idx) => {
      if (!item.bakedAdjustments || !item.bakedAdjustments.breakdown) {
        return item;
      }
      
      const itemKey = item.id || `temp-${idx}`;
      
      // Check if this item has the markup we're deleting
      const hasThisMarkup = item.bakedAdjustments.breakdown.some(b => b.markupId === markupId);
      if (!hasThisMarkup) {
        return item; // Not affected, skip
      }
      
      // Get OLD breakdown and delta
      const oldDelta = item.bakedAdjustments.breakdown.find(b => b.markupId === markupId)?.delta || 0;
      const oldMarkupTotal = item.bakedAdjustments.markupTotal || 0;
      
      // Filter out this markup's delta
      const newBreakdown = item.bakedAdjustments.breakdown.filter(b => b.markupId !== markupId);
      const newMarkupTotal = newBreakdown.reduce((sum, b) => sum + b.delta, 0);
      
      // Recompute line_total from baseline (DO NOT change unit_price - keep original)
      // Get baseline: prefer stored value, fallback to current - old total markup
      const baseline = perItemBaseBefore[itemKey] ?? (item.line_total - oldMarkupTotal);
      const newLineTotal = bankersRound(baseline + newMarkupTotal, 2);
      // DO NOT change unit_price - it should stay original
      
      console.log('[Markup] Recomputing item from baseline:', {
        name: item.product_name,
        baseline,
        oldMarkupTotal,
        newMarkupTotal,
        oldLineTotal: item.line_total,
        newLineTotal,
        unitPriceUnchanged: item.unit_price,
        method: perItemBaseBefore[itemKey] ? 'stored' : 'computed'
      });
      
      return {
        ...item,
        // unit_price stays ORIGINAL - not modified by markup operations
        line_total: newLineTotal,
        bakedAdjustments: newBreakdown.length > 0 ? {
          markupTotal: newMarkupTotal,
          breakdown: newBreakdown
        } : undefined
      };
    });
    
    // Remove markup from bakedMarkups array
    const updatedMarkups = (quotePreview.bakedMarkups || []).filter(m => m.id !== markupId);
    
    // Recalculate totals
    const newSubtotal = updatedItems.reduce((sum, item) => sum + item.line_total, 0);
    
    // Update charges to reflect new base (taxes may need recalculation)
    const {
      charges: updatedCharges,
      totalChargeAmount,
      taxAmount,
      taxRate,
    } = recalculateChargesForLineItems(updatedItems, quotePreview.charges);
    
    const discountAmount = quotePreview.discount_amount || 0;
    const newTotal = bankersRound(newSubtotal + totalChargeAmount - discountAmount, 2);
    
    console.log('[Markup] delete:totals { oldSubtotal:', quotePreview.subtotal, ', newSubtotal:', newSubtotal, ', delta:', quotePreview.subtotal - newSubtotal, '}');
    console.log('[Markup] delete:totals { oldTotal:', quotePreview.total_price, ', newTotal:', newTotal, ', delta:', quotePreview.total_price - newTotal, '}');
    console.log('[Markup] delete:charges { oldCharges:', quotePreview.charges?.reduce((sum, c) => sum + (c.calculated_amount || 0), 0) || 0, ', newCharges:', totalChargeAmount, '}');
    
    setQuotePreview({
      ...quotePreview,
      line_items: updatedItems,
      bakedMarkups: updatedMarkups,
      charges: updatedCharges,
      subtotal: newSubtotal,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      total_price: newTotal
    });
    
    console.log('[Telemetry] markup:remove { markupId:', markupId, '}');
    console.log('[Markup] delete:success { markupId:', markupId, ', newSubtotal:', newSubtotal, ', newTotal:', newTotal, ', remainingMarkups:', updatedMarkups.length, '}');
    toast.success(`Removed ${markup.label} - totals updated`);
  }

  const safeNumber = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  // Banker's rounding (round half to even)
  function bankersRound(value: number, places: number = 2): number {
    const multiplier = Math.pow(10, places);
    const shifted = value * multiplier;
    const floor = Math.floor(shifted);
    const remainder = shifted - floor;
    
    if (remainder < 0.5) {
      return floor / multiplier;
    } else if (remainder > 0.5) {
      return Math.ceil(shifted) / multiplier;
    } else {
      // Exactly 0.5 - round to even
      return (floor % 2 === 0 ? floor : floor + 1) / multiplier;
    }
  }

  // Match items based on selector
  function matchItemsBySelector(
    items: ProductSuggestion[],
    appliesTo: 'all' | 'exclude_products',
    excludedProducts: string[]
  ): ProductSuggestion[] {
    if (appliesTo === 'all') {
      return items;
    } else {
      return items.filter(item => !excludedProducts.includes(item.product_name));
    }
  }

  function recalculateChargesForLineItems(
    items: ProductSuggestion[],
    charges?: ChargeConfig[] | null
  ): {
    charges: ChargeConfig[];
    totalChargeAmount: number;
    taxRate: number;
    taxAmount: number;
  } {
    if (!Array.isArray(charges) || charges.length === 0) {
      return { charges: [], totalChargeAmount: 0, taxRate: 0, taxAmount: 0 };
    }

    const updatedCharges = charges
      .filter(Boolean)
      .map((charge) => {
        const rate = safeNumber(charge.rate);
        const excluded = charge.excluded_products || [];
        const applicableItems = matchItemsBySelector(items, charge.applies_to, excluded);
        const chargeBase = applicableItems.reduce((sum, item) => sum + item.line_total, 0);
        const chargeAmount = bankersRound(chargeBase * rate, 2);

        return {
          ...charge,
          rate,
          calculated_amount: chargeAmount,
          applies_to_total: bankersRound(chargeBase, 2),
          applies_to_count: applicableItems.length,
        };
      });

    const totalChargeAmount = updatedCharges.reduce(
      (sum, charge) => sum + safeNumber(charge.calculated_amount),
      0
    );

    const taxCharges = updatedCharges.filter((charge) =>
      (charge.name || "").toLowerCase().includes("tax")
    );

    const taxRate = taxCharges.reduce((sum, charge) => sum + safeNumber(charge.rate), 0);
    const taxAmount = taxCharges.reduce(
      (sum, charge) => sum + safeNumber(charge.calculated_amount),
      0
    );

    return {
      charges: updatedCharges,
      totalChargeAmount: bankersRound(totalChargeAmount, 2),
      taxRate,
      taxAmount: bankersRound(taxAmount, 2),
    };
  }

  function buildQuotePreviewUpdate(
    items: ProductSuggestion[],
    previous: QuotePreview | null,
    overrides: Partial<QuotePreview> = {}
  ): QuotePreview {
    const subtotal = bankersRound(
      items.reduce((sum, item) => sum + item.line_total, 0),
      2
    );

    const discountAmount = overrides.discount_amount ?? previous?.discount_amount ?? 0;
    const incomingCharges =
      overrides.charges ??
      previous?.charges ??
      (Array.isArray(overrides.charges) ? overrides.charges : undefined);

    const {
      charges: recalculatedCharges,
      totalChargeAmount,
      taxAmount,
      taxRate,
    } = recalculateChargesForLineItems(items, incomingCharges as ChargeConfig[] | undefined);

    const totalPrice = bankersRound(subtotal + totalChargeAmount - discountAmount, 2);

    const result: QuotePreview = {
      line_items: items,
      subtotal,
      discount_amount: discountAmount,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total_price: totalPrice,
    };

    const bakedMarkups = overrides.bakedMarkups ?? previous?.bakedMarkups;
    if (Array.isArray(bakedMarkups) && bakedMarkups.length > 0) {
      result.bakedMarkups = bakedMarkups;
    } else if (Array.isArray(overrides.bakedMarkups) && overrides.bakedMarkups.length === 0) {
      result.bakedMarkups = [];
    } else if (Array.isArray(previous?.bakedMarkups) && (previous?.bakedMarkups?.length || 0) > 0) {
      result.bakedMarkups = previous?.bakedMarkups;
    }

    if (recalculatedCharges.length > 0 || (Array.isArray(incomingCharges) && incomingCharges.length === 0)) {
      result.charges = recalculatedCharges;
    }

    return result;
  }

  function normalizeQuotePreview(preview: QuotePreview | null): QuotePreview | null {
    if (!preview || !Array.isArray(preview.line_items)) {
      return preview;
    }

    return buildQuotePreviewUpdate(preview.line_items, preview, {
      charges: preview.charges || [],
      bakedMarkups: preview.bakedMarkups || [],
      discount_amount: safeNumber(preview.discount_amount),
    });
  }

  // Calculate markup preview
  function calculateMarkupPreview() {
    if (!quotePreview) {
      return {
        baseCount: 0,
        baseTotal: 0,
        addToCount: 0,
        addToTotal: 0,
        markupAmount: 0,
        mode: currentMarkup.lumpSum ? 'amount' : 'percent',
        effectiveRate: 0
      };
    }
    
    const baseItems = matchItemsBySelector(
      quotePreview.line_items,
      currentMarkup.baseAppliesTo,
      currentMarkup.baseSelectedProducts
    );
    
    const addToItems = matchItemsBySelector(
      quotePreview.line_items,
      currentMarkup.addToAppliesTo,
      currentMarkup.addToSelectedProducts
    );
    
    const baseTotal = baseItems.reduce((sum, item) => sum + item.line_total, 0);
    const addToTotal = addToItems.reduce((sum, item) => sum + item.line_total, 0);
    
    const rateDecimal = parseFloat(currentMarkup.rate) / 100 || 0;
    const lumpSumValue = bankersRound(parseFloat(currentMarkup.lumpSum || '0') || 0, 2);
    const useLumpSum = lumpSumValue > 0;
    const markupAmount = useLumpSum ? lumpSumValue : bankersRound(baseTotal * rateDecimal, 2);
    
    return {
      baseCount: baseItems.length,
      baseTotal,
      addToCount: addToItems.length,
      addToTotal,
      markupAmount,
      mode: useLumpSum ? 'amount' : 'percent',
      effectiveRate: baseTotal > 0 ? markupAmount / baseTotal : 0
    };
  }

  // Add baked markup to quote
  async function addBakedMarkupToQuote() {
    if (!quotePreview) return;
    
    const rateDecimal = parseFloat(currentMarkup.rate) / 100 || 0;
    const lumpSumValue = bankersRound(parseFloat(currentMarkup.lumpSum || '0') || 0, 2);
    const useLumpSum = lumpSumValue > 0;
    if (!useLumpSum && rateDecimal <= 0) {
      toast.error("Enter a percentage or a lump sum amount");
      return;
    }
    
    // If editing, first remove old markup's deltas from items
    let baseItems = quotePreview.line_items;
    if (editingMarkupId) {
      const oldMarkup = quotePreview.bakedMarkups?.find(m => m.id === editingMarkupId);
      if (oldMarkup) {
        console.log('[Markup] edit:remove-old-deltas { markupId:', editingMarkupId, '}');
        // Remove old deltas from items
        baseItems = baseItems.map(item => {
          if (!item.bakedAdjustments || !item.bakedAdjustments.breakdown) {
            return item;
          }
          
          const oldDelta = item.bakedAdjustments.breakdown.find(b => b.markupId === editingMarkupId)?.delta || 0;
          const newBreakdown = item.bakedAdjustments.breakdown.filter(b => b.markupId !== editingMarkupId);
          const newMarkupTotal = newBreakdown.reduce((sum, b) => sum + b.delta, 0);
          
          if (oldDelta > 0) {
            const newLineTotal = item.line_total - oldDelta;
            const newUnitPrice = newLineTotal / item.quantity;
            
            return {
              ...item,
              unit_price: newUnitPrice,
              line_total: newLineTotal,
              bakedAdjustments: newBreakdown.length > 0 ? {
                markupTotal: newMarkupTotal,
                breakdown: newBreakdown
              } : undefined
            };
          }
          
          return {
            ...item,
            bakedAdjustments: newBreakdown.length > 0 ? {
              markupTotal: newMarkupTotal,
              breakdown: newBreakdown
            } : undefined
          };
        });
      }
    }
    
    const baseMatches = matchItemsBySelector(
      baseItems,
      currentMarkup.baseAppliesTo,
      currentMarkup.baseSelectedProducts
    );
    const addToMatches = matchItemsBySelector(
      baseItems,
      currentMarkup.addToAppliesTo,
      currentMarkup.addToSelectedProducts
    );
    const baseTotal = baseMatches.reduce((sum, item) => sum + item.line_total, 0);
    const addToTotal = addToMatches.reduce((sum, item) => sum + item.line_total, 0);
    if (baseMatches.length === 0) {
      toast.error("No base items match the selection");
      return;
    }
    
    if (addToMatches.length === 0) {
      toast.error("No 'Add To' items match the selection");
      return;
    }
    
    const markupAmount = useLumpSum ? lumpSumValue : bankersRound(baseTotal * rateDecimal, 2);
    if (markupAmount <= 0) {
      toast.error("Markup amount must be greater than 0");
      return;
    }
    
    const preview = {
      baseCount: baseMatches.length,
      addToCount: addToMatches.length,
      baseTotal,
      addToTotal,
      markupAmount
    };
    
    // Get current user for audit trail
    let createdBy: UserRef;
    try {
      const user = currentUser || await getCurrentUserClient();
      if (user) {
        createdBy = user;
      } else {
        // No user available - use anonymous fallback
        createdBy = getAnonymousUser();
        console.warn('[Auth] No user available for markup creation, using anonymous fallback');
        console.log('[Telemetry] user:missing { context: "addBakedMarkupToQuote" }');
      }
    } catch (error) {
      // Error fetching user - use anonymous fallback
      createdBy = getAnonymousUser();
      console.warn('[Auth] Error fetching user for markup creation:', error);
      console.log('[Telemetry] user:missing { context: "addBakedMarkupToQuote", error: true }');
    }
    
    // Use existing ID if editing, otherwise create new
    const markupId = editingMarkupId || `markup-${Date.now()}`;
    
    // Generate stable keys for all items (for reliable cross-version matching)
    const itemStableKeys = new Map<number, string>();
    baseItems.forEach((item, idx) => {
      itemStableKeys.set(idx, generateStableKey(item));
    });
    
    // Calculate per-item deltas (using stable keys, not temp IDs)
    const perItemDeltas: Record<string, number> = {}; // stableKey -> delta
    // Build index map for addToMatches to find their stable keys
    const addToMatchIndices = new Map<any, number>();
    addToMatches.forEach(item => {
      const idx = baseItems.findIndex(bi => bi === item);
      if (idx >= 0) {
        addToMatchIndices.set(item, idx);
      }
    });
    
    if (currentMarkup.distribution === 'proportional') {
      // Proportional distribution based on line totals
      const addToItemsWithKeys = addToMatches.map(item => {
        const idx = addToMatchIndices.get(item);
        const stableKey = idx !== undefined ? itemStableKeys.get(idx) : undefined;
        return {
          ...item,
          stableKey: stableKey || `fallback-${item.product_name}`
        };
      });
      
      // Calculate each item's share
      const shares = addToItemsWithKeys.map(item => ({
        stableKey: item.stableKey,
        share: preview.addToTotal > 0 ? item.line_total / preview.addToTotal : 0
      }));
      
      // Distribute with rounding
      const deltas = shares.map((s, idx) => {
        const delta = bankersRound(preview.markupAmount * s.share, 2);
        return { stableKey: s.stableKey, delta };
      });
      
      // Calculate rounding residue
      const totalDistributed = deltas.reduce((sum, d) => sum + d.delta, 0);
      const residue = bankersRound(preview.markupAmount - totalDistributed, 2);
      
      // Assign residue to the item with the largest share
      if (residue !== 0 && deltas.length > 0) {
        const largestIdx = shares.reduce((maxIdx, s, idx) =>
          s.share > shares[maxIdx].share ? idx : maxIdx
        , 0);
        deltas[largestIdx].delta = bankersRound(deltas[largestIdx].delta + residue, 2);
      }
      
      deltas.forEach(d => {
        perItemDeltas[d.stableKey] = d.delta;
      });
    } else if (currentMarkup.distribution === 'even') {
      // Even distribution
      const evenShare = bankersRound(preview.markupAmount / preview.addToCount, 2);
      const totalDistributed = evenShare * preview.addToCount;
      const residue = bankersRound(preview.markupAmount - totalDistributed, 2);
      
      addToMatches.forEach((item, idx) => {
        const itemIdx = addToMatchIndices.get(item);
        const stableKey = itemIdx !== undefined ? itemStableKeys.get(itemIdx) : undefined;
        if (stableKey) {
          perItemDeltas[stableKey] = idx === 0 ? bankersRound(evenShare + residue, 2) : evenShare;
        }
      });
    } else if (currentMarkup.distribution === 'single' && currentMarkup.singleItemIndex !== null) {
      // Single item gets all markup
      const singleItem = addToMatches[currentMarkup.singleItemIndex];
      if (singleItem) {
        const itemIdx = addToMatchIndices.get(singleItem);
        const stableKey = itemIdx !== undefined ? itemStableKeys.get(itemIdx) : undefined;
        if (stableKey) {
          perItemDeltas[stableKey] = preview.markupAmount;
        }
      }
    }
    
    // Capture per-item baselines BEFORE applying deltas (critical for recompute on delete)
    // AND build targets array for rehydration with amountCents
    const perItemBaseBefore: Record<string, number> = {}; // stableKey -> baseline
    const targets: Array<{ item_id?: string; itemId?: string; stable_key: string; amountCents: number }> = [];
    
    baseItems.forEach((item, idx) => {
      const stableKey = itemStableKeys.get(idx);
      if (!stableKey) return;
      
      const delta = perItemDeltas[stableKey] || 0;
      if (delta > 0) {
        perItemBaseBefore[stableKey] = item.line_total; // Store price BEFORE this markup
        const amountCents = Math.round(delta * 100); // Convert dollars to cents
        targets.push({
          item_id: item.id && !item.id.startsWith('temp-') ? item.id : undefined,
          itemId: item.id, // Also include camelCase for compatibility
          stable_key: stableKey,
          amountCents // Store amount directly in target
        });
      }
    });
    
    // Create new markup config
    const effectivePercent = baseTotal > 0 ? markupAmount / baseTotal : 0;
    
    const newMarkup: import("@/types/database").BakedMarkupConfig = {
      id: markupId,
      label: currentMarkup.name,
      percent: effectivePercent,
      calculationMode: useLumpSum ? 'amount' : 'percent',
      lumpSumAmount: useLumpSum ? markupAmount : undefined,
      baseSelector: {
        include: currentMarkup.baseAppliesTo === 'all' ? 'all' : baseMatches.map(i => `item:${i.product_name}`),
        exclude: currentMarkup.baseAppliesTo === 'exclude_products' ? currentMarkup.baseSelectedProducts : undefined
      },
      addToSelector: {
        include: currentMarkup.addToAppliesTo === 'all' ? 'all' : addToMatches.map(i => `item:${i.product_name}`),
        exclude: currentMarkup.addToAppliesTo === 'exclude_products' ? currentMarkup.addToSelectedProducts : undefined
      },
      distribution: currentMarkup.distribution === 'single' && currentMarkup.singleItemIndex !== null
        ? { singleItemId: addToMatches[currentMarkup.singleItemIndex]?.id || `temp-${currentMarkup.singleItemIndex}` }
        : currentMarkup.distribution as 'proportional' | 'even',
      rounding: { mode: 'bankers', places: 2 },
      targets, // NEW: Explicit list of targeted items with stable keys for rehydration
      audited: {
        base: preview.baseTotal,
        totalMarkup: preview.markupAmount,
        perItemDeltas, // Now uses stableKey as keys
        perItemBaseBefore // Now uses stableKey as keys
      },
      createdAt: new Date().toISOString(),
      createdBy: createdBy.id,
      supersededById: editingMarkupId ? undefined : undefined // Will be set if this gets edited later
    };
    
    console.log('[Markup] Storing baselines:', {
      markupId,
      baselineCount: Object.keys(perItemBaseBefore).length,
      baselines: Object.entries(perItemBaseBefore).map(([k, v]) => ({ item: k, baseline: v }))
    });
    
    // Apply baked adjustments to items (starting from baseItems which already has old deltas removed)
    const updatedItems = baseItems.map((item, idx) => {
      const stableKey = itemStableKeys.get(idx);
      if (!stableKey) return item;
      
      const delta = perItemDeltas[stableKey] || 0;
      
      if (delta === 0) return {
        ...item,
        stableKey // Add stable key to item for future reference
      };
      
      const newLineTotal = bankersRound(item.line_total + delta, 2);
      // DO NOT change unit_price - keep original, only markup the line_total
      
      return {
        ...item,
        stableKey, // Add stable key to item for future reference
        line_total: newLineTotal,
        // unit_price stays ORIGINAL - not modified by markup
        bakedAdjustments: {
          markupTotal: bankersRound((item.bakedAdjustments?.markupTotal || 0) + delta, 2),
          breakdown: [
            ...(item.bakedAdjustments?.breakdown || []),
            { markupId, delta }
          ]
        }
      };
    });
    
    const newSubtotal = updatedItems.reduce((sum, item) => sum + item.line_total, 0);

    // Update bakedMarkups array - replace if editing, append if new
    const updatedBakedMarkups = editingMarkupId
      ? (quotePreview.bakedMarkups || []).map(m => m.id === editingMarkupId ? newMarkup : m)
      : [...(quotePreview.bakedMarkups || []), newMarkup];

    const updatedPreview = buildQuotePreviewUpdate(updatedItems, quotePreview, {
      bakedMarkups: updatedBakedMarkups,
      charges: quotePreview.charges || [],
    });

    setQuotePreview(updatedPreview);
    
    // Telemetry
    if (editingMarkupId) {
      console.log('[Telemetry] markup:edit { markupId:', markupId, ', mode:', useLumpSum ? 'amount' : 'percent', ', percent:', effectivePercent, ', lumpSum:', useLumpSum ? markupAmount : null, ', totalDelta:', preview.markupAmount, '}');
      toast.success(`Updated ${currentMarkup.name} - totals recalculated`);
    } else {
      console.log('[Telemetry] markup:add { markupId:', markupId, ', mode:', useLumpSum ? 'amount' : 'percent', ', percent:', effectivePercent, ', lumpSum:', useLumpSum ? markupAmount : null, ', total:', preview.markupAmount, ', targets:', preview.addToCount, ', createdBy:', createdBy.id, '}');
      toast.success(`Added ${currentMarkup.name} - $${formatCurrency(preview.markupAmount)} baked into ${preview.addToCount} items`);
    }
    
    // Reset form
    setCurrentMarkup({
      name: 'Markup',
      rate: '',
      lumpSum: '',
      baseAppliesTo: 'all',
      baseSelectedProducts: [],
      addToAppliesTo: 'all',
      addToSelectedProducts: [],
      distribution: 'proportional',
      singleItemIndex: null,
      showAdvanced: false
    });
    setEditingMarkupId(null);
    setShowMarkupConfig(false);
    
    console.log('[Markup] ' + (editingMarkupId ? 'Updated' : 'Added') + ' baked markup:', {
      markupId,
      base: preview.baseTotal,
      percent: rateDecimal,
      totalMarkup: preview.markupAmount,
      distribution: currentMarkup.distribution,
      itemsAffected: Object.keys(perItemDeltas).length
    });
    
    toast.success("Markup added and baked into prices");
  }

  // Edit quantity for a preview product
  function editPreviewProductQuantity(index: number, newQuantity: number) {
    if (!quotePreview || newQuantity < 0.01) return;
    
    const updatedItems = [...quotePreview.line_items];
    const item = updatedItems[index];
    
    // Update quantity and line total
    item.quantity = newQuantity;
    item.line_total = item.unit_price * newQuantity;
    
    const updatedPreview = buildQuotePreviewUpdate(updatedItems, quotePreview);
    setQuotePreview(updatedPreview);
  }

  // Drag and drop handlers
  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleDragLeave() {
    setDragOverIndex(null);
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    
    if (!quotePreview || draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    
    const updatedItems = [...quotePreview.line_items];
    const [draggedItem] = updatedItems.splice(draggedIndex, 1);
    updatedItems.splice(dropIndex, 0, draggedItem);
    
    setQuotePreview({
      ...quotePreview,
      line_items: updatedItems
    });
    
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  async function clearChat() {
    if (!confirm("Are you sure you want to clear the chat and start over? This will remove all messages and reset the quote preview.")) {
      return;
    }

    try {
      // Set clearing flag to prevent race conditions
      isClearing.current = true;
      console.log("🧹 Starting chat clear process...");

      // First, check how many messages exist
      const { count: beforeCount } = await supabase
        .from("chat_messages")
        .select("*", { count: 'exact', head: true })
        .eq("project_id", projectId);

      console.log(`📊 Found ${beforeCount} messages to delete for project ${projectId}`);

      // Clear chat messages from database
      const { error: deleteError } = await supabase
        .from("chat_messages")
        .delete()
        .eq("project_id", projectId);

      if (deleteError) {
        console.error("❌ Error clearing chat:", deleteError);
        throw deleteError;
      }

      // Verify deletion worked
      const { count: afterCount } = await supabase
        .from("chat_messages")
        .select("*", { count: 'exact', head: true })
        .eq("project_id", projectId);

      console.log(`✅ Chat messages deleted. Before: ${beforeCount}, After: ${afterCount}`);

      if (afterCount && afterCount > 0) {
        console.error(`⚠️ Warning: ${afterCount} messages still exist after delete!`);
        throw new Error(`Delete failed: ${afterCount} messages remain`);
      }

      // Clear working state from database
      const { error: stateError } = await supabase
        .from("project_working_state")
        .delete()
        .eq("project_id", projectId);

      if (stateError) {
        console.error("Error clearing working state:", stateError);
        throw stateError;
      }

      console.log("✅ Working state deleted for project:", projectId);

      // Wait a moment to ensure deletes are committed
      await new Promise(resolve => setTimeout(resolve, 300));

      // Reset all state
      setMessages([]);
      setSuggestedProducts([]);
      setQuotePreview(null);
      setShowSplitView(false);
      setSelectAll(false);
      setEditingQuantityIndex(null);
      setTempQuantity("");
      setInput("");
      
      // Create and persist new welcome message
      const welcomeMessage: ChatMessage = {
        id: 'temp-welcome-' + Date.now(),
        project_id: projectId,
        role: 'assistant',
        content: `Welcome to the ${projectName} project! I'm here to help you create a professional quote.\n\nTo get started, please describe the scope of work for this project. What services or products does the client need?`,
        metadata: {},
        created_at: new Date().toISOString()
      };
      
      // Persist welcome message to database
      const { data: newMsg, error: msgError } = await supabase
        .from("chat_messages")
        .insert({
          project_id: projectId,
          role: "assistant",
          content: welcomeMessage.content,
          metadata: {},
        })
        .select()
        .single();

      if (msgError) {
        console.error("❌ Failed to create welcome message:", msgError);
        // Still show it in UI even if DB insert fails
        setMessages([welcomeMessage]);
        hasLoadedMessages.current = true;
      } else {
        console.log("✅ New welcome message created:", newMsg.id);
        setMessages([newMsg]);
        hasLoadedMessages.current = true;
      }

      // Verify final state
      const { count: finalCount } = await supabase
        .from("chat_messages")
        .select("*", { count: 'exact', head: true })
        .eq("project_id", projectId);

      console.log(`📋 Final message count: ${finalCount} (should be 1 - the welcome message)`);
      
      // Clear any stopped message timestamps for this project
      const stoppedMessages = JSON.parse(localStorage.getItem('stoppedMessages') || '{}');
      if (stoppedMessages[projectId]) {
        delete stoppedMessages[projectId];
        localStorage.setItem('stoppedMessages', JSON.stringify(stoppedMessages));
        console.log('🧹 Cleared stopped message timestamp');
      }
      
      toast.success("Chat cleared! Starting fresh.");
    } catch (error: any) {
      console.error("❌ Error clearing chat:", error);
      toast.error("Failed to clear chat: " + (error.message || "Unknown error"));
    } finally {
      // Always reset clearing flag
      isClearing.current = false;
      console.log("🏁 Chat clear process complete");
    }
  }

  async function submitQuote() {
    if (!quotePreview) {
      toast.error("Please apply changes first");
      return;
    }

    setSubmitting(true);
    try {
      // Check if we're in edit mode
      if (editMode && editSessionId && editQuoteId) {
        // Submit as edited version
        const { submitEditedQuote } = await import("@/lib/editSessionController");
        
        console.log('[Submit] submit:start { quoteId:', editQuoteId, ', baseVersion:', editVersion, ', session:', editSessionId, '}');
        
        const modifiedQuote = {
          items: quotePreview.line_items,
          subtotal: quotePreview.subtotal,
          tax_rate: quotePreview.tax_rate,
          tax_amount: quotePreview.tax_amount,
          discount_amount: quotePreview.discount_amount,
          total_price: quotePreview.total_price,
          profit_margin: 0, // Calculate actual profit margin from cost prices
          charges: quotePreview.charges,
          bakedMarkups: quotePreview.bakedMarkups // Include baked markups for persistence
        };
        
        const updatedQuote = await submitEditedQuote(
          editSessionId,
          modifiedQuote,
          editVersion!, // baseVersion
          changeNotes.trim() || undefined
        );
        
        // Clear edit mode state
        setEditMode(false);
        setEditSessionId(null);
        setEditQuoteId(null);
        setEditVersion(null);
        setEditQuoteName(null);
        
        // Clear working state and UI
        setSuggestedProducts([]);
        setQuotePreview(null);
        setShowSplitView(false);
        
        // Add success message to chat
        const successMessage: Partial<ChatMessage> = {
          project_id: projectId,
          role: "assistant",
          content: `✅ Quote v${updatedQuote.version_number} has been saved!\n\nYour edits have been submitted as a new version. The previous version remains accessible in the Quote Log.`,
          metadata: {},
        };
        
        const { data: successMsg } = await supabase
          .from("chat_messages")
          .insert(successMessage)
          .select()
          .single();
        
        if (successMsg) {
          setMessages((prev) => [...prev, successMsg]);
        }
        
        // Notify log panel to refresh
        window.dispatchEvent(new CustomEvent('quoteCreated', { detail: { projectId, quoteId: editQuoteId } }));
        
        console.log('[EditUI] ui:edit:save { quoteId:', editQuoteId, ', from: v', editVersion, ', to: v', updatedQuote.version_number, '}');
        toast.success(`Quote v${updatedQuote.version_number} saved successfully!`);
        setSubmitting(false);
        return;
      }
      
      // Normal quote creation flow (not editing)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Generate quote number
      const { count } = await supabase
        .from("quotes")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId);
      
      const quoteNumber = `Q-${String((count || 0) + 1).padStart(4, '0')}`;

      // Create quote
      const { data: quote, error: quoteError} = await supabase
        .from("quotes")
        .insert({
          project_id: projectId,
          user_id: user.id,
          quote_number: quoteNumber,
          quote_name: `${projectName} - ${new Date().toLocaleDateString()}`,
          version_number: 1,
          status: "draft",
          scope_of_work: "Generated from AI chat",
          subtotal: quotePreview.subtotal,
          tax_rate: quotePreview.tax_rate,
          tax_amount: quotePreview.tax_amount,
          discount_rate: 0,
          discount_amount: quotePreview.discount_amount,
          total_price: quotePreview.total_price,
          profit_margin: 0,
          charges: quotePreview.charges || [], // Save charges with quote
          baked_markups: quotePreview.bakedMarkups || [], // Save baked markups with quote (DB uses snake_case)
        })
        .select()
        .single();
      
      console.log('[Submit] Saved quote with charges, discounts, and markups:', {
        quoteId: quote?.id,
        chargeCount: quotePreview.charges?.length || 0,
        bakedMarkupCount: quotePreview.bakedMarkups?.length || 0,
        itemsWithDiscounts: quotePreview.line_items.filter(i => i.discount_percent && i.discount_percent > 0).length,
        itemsWithBakedAdjustments: quotePreview.line_items.filter(i => i.bakedAdjustments && i.bakedAdjustments.markupTotal && i.bakedAdjustments.markupTotal > 0).length,
        discounts: quotePreview.line_items.map(i => ({ name: i.product_name, discount: i.discount_percent }))
      });

      if (quoteError) throw quoteError;

      // Create quote items
      if (quote && quotePreview.line_items.length > 0) {
        const quoteItems = quotePreview.line_items.map((item, index) => ({
          quote_id: quote.id,
          product_id: null,
          product_number: null,
          product_name: item.product_name,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percent: item.discount_percent || 0, // Preserve item discounts
          line_total: item.line_total,
          sort_order: index,
        }));

        const { error: itemsError } = await supabase
          .from("quote_items")
          .insert(quoteItems);

        if (itemsError) throw itemsError;
      }

      // Clear working state only (keep chat history)
      const { error: stateError } = await supabase
        .from("project_working_state")
        .delete()
        .eq("project_id", projectId);

      if (stateError) {
        console.error("Failed to clear working state:", stateError);
      }

      console.log("✅ Working state cleared (suggested products and preview)");

      // Reset UI state only (messages stay in database)
      setSuggestedProducts([]);
      setQuotePreview(null);
      setShowSplitView(false);
      
      // Add a success message to the chat
      const successMessage: Partial<ChatMessage> = {
        project_id: projectId,
        role: "assistant",
        content: `✅ Quote ${quoteNumber} has been saved to your Quote Log!\n\nThe chat history has been preserved. You can continue working on this project or use "Clear Chat" to start fresh.`,
        metadata: {},
      };

      const { data: successMsg, error: msgError } = await supabase
        .from("chat_messages")
        .insert(successMessage)
        .select()
        .single();

      if (!msgError && successMsg) {
        setMessages((prev) => [...prev, successMsg]);
      }
      
      // Dispatch custom event to notify LogPanel to refresh quotes
      window.dispatchEvent(new CustomEvent('quoteCreated', { detail: { projectId, quoteId: quote.id } }));
      
      toast.success(`Quote ${quoteNumber} saved successfully!`);
    } catch (error: any) {
      // Supabase errors have nested structure - extract useful info
      const errorInfo = {
        message: error?.message || error?.error_description || error?.msg,
        code: error?.code || error?.error || error?.status,
        details: error?.details || error?.error_description,
        hint: error?.hint,
        name: error?.name,
        // Supabase-specific fields
        statusCode: error?.statusCode,
        statusText: error?.statusText
      };
      
      console.error("[submitQuote] Error:", error);
      console.error("[submitQuote] Error type:", typeof error);
      console.error("[submitQuote] Error keys:", error ? Object.keys(error) : 'null');
      console.error("[submitQuote] Parsed error info:", errorInfo);
      
      // Try to serialize the full error for debugging
      try {
        console.error("[submitQuote] Full error JSON:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
      } catch (jsonError) {
        console.error("[submitQuote] Could not serialize error to JSON");
      }
      
      // Handle empty or malformed error objects
      if (!error || (typeof error === 'object' && Object.keys(error).length === 0)) {
        console.error("[submitQuote] EMPTY ERROR OBJECT DETECTED");
        toast.error(
          <div className="flex flex-col gap-2">
            <div className="font-medium">Submission Failed</div>
            <div className="text-sm">
              An unknown error occurred. Please check the browser console for details and try again.
            </div>
          </div>,
          { duration: 8000 }
        );
        setSubmitting(false);
        return;
      }
      
      // Handle specific error codes
      const errorCode = error?.code || 
        (error?.message?.includes('baked_markups') || error?.message?.includes('bakedMarkups') || 
         error?.message?.includes('schema cache') || error?.message?.includes('column') ? 'DB_MIGRATION_REQUIRED' :
         error?.message?.includes('VERSION_CONFLICT') ? 'VERSION_CONFLICT' : 
         error?.message?.includes('CONCURRENCY_CONFLICT') ? 'CONCURRENCY_CONFLICT' : 
         error?.message?.includes('DB_ERROR') ? 'DB_ERROR' : 
         error?.message?.includes('invalid input syntax') ? 'UUID_ERROR' : null);
      
      console.log('[Submit] submit:error { code:', errorCode, ', message:', error?.message, ', details:', error?.details, '}');
      
      if (errorCode === 'DB_MIGRATION_REQUIRED') {
        toast.error(
          <div className="flex flex-col gap-2">
            <div className="font-medium">⚠️ Database Migration Required</div>
            <div className="text-sm">
              The database needs to be updated to support baked markups.
            </div>
            <div className="text-sm font-medium mt-1">
              Steps to fix:
            </div>
            <ol className="text-xs text-gray-600 list-decimal list-inside space-y-1">
              <li>Open Supabase SQL Editor</li>
              <li>Run the migration from APPLY_BAKED_MARKUPS_MIGRATION.md</li>
              <li>Restart your dev server</li>
            </ol>
            <div className="text-xs text-gray-500 mt-1">
              Error: {error?.message?.substring(0, 100)}
            </div>
          </div>,
          { duration: 15000 }
        );
        console.error("[submitQuote] DB_MIGRATION_REQUIRED - Column 'baked_markups' not found");
        console.error("See APPLY_BAKED_MARKUPS_MIGRATION.md for migration instructions");
      } else if (errorCode === 'VERSION_CONFLICT') {
        const details = error?.details || {};
        const currentVersion = details.currentVersion || (editVersion! + 1);
        
        toast.error(
          <div className="flex flex-col gap-2">
            <div className="font-medium">Quote Was Updated</div>
            <div className="text-sm">
              This quote was updated to v{currentVersion} while you were editing v{editVersion}.
            </div>
            <div className="text-sm">
              {details.hasOverlap ? (
                <>Your changes overlap with the new version. Please review the latest version and re-edit if needed.</>
              ) : (
                <>Your changes have been automatically merged into v{currentVersion + 1}.</>
              )}
            </div>
          </div>,
          { duration: details.hasOverlap ? 10000 : 5000 }
        );
        
        // Auto-exit edit mode on true conflict
        if (details.hasOverlap) {
          setTimeout(async () => {
            if (editSessionId) {
              console.log('[EditUI] Auto-exiting edit mode due to version conflict');
              const { cancelEditSession } = await import("@/lib/editSessionController");
              await cancelEditSession(editSessionId);
              setEditMode(false);
              setEditSessionId(null);
              setEditQuoteId(null);
              setEditVersion(null);
              setEditQuoteName(null);
              setChangeNotes("");
              setShowChangeNotes(false);
              setQuotePreview(null);
              setShowSplitView(false);
            }
          }, 500);
        }
        
      } else if (errorCode === 'CONCURRENCY_CONFLICT') {
        toast.error(
          <div className="flex flex-col gap-2">
            <div className="font-medium">Someone Else Is Editing</div>
            <div className="text-sm">
              Another user is currently editing this quote. Please wait for them to finish.
            </div>
          </div>,
          { duration: 8000 }
        );
      } else if (errorCode === 'UUID_ERROR') {
        console.error("[submitQuote] UUID casting error:", error);
        toast.error(
          <div className="flex flex-col gap-2">
            <div className="font-medium">UUID Error</div>
            <div className="text-sm">
              A composite ID was incorrectly sent to a UUID field. This is likely a bug.
            </div>
            <div className="text-xs text-gray-600">
              Error: {error?.message?.substring(0, 100)}
            </div>
          </div>,
          { duration: 10000 }
        );
      } else if (errorCode === 'DB_ERROR' || error?.message?.includes('invalid input syntax')) {
        console.error("[submitQuote] Database error:", error);
        const errorMsg = error?.message || error?.details?.message || "A database error occurred";
        toast.error(
          <div className="flex flex-col gap-2">
            <div className="font-medium">Database Error</div>
            <div className="text-sm">
              {errorMsg}
            </div>
            {error?.details?.hint && (
              <div className="text-xs text-gray-600">
                Hint: {error.details.hint}
              </div>
            )}
          </div>,
          { duration: 8000 }
        );
      } else if (error?.message) {
        toast.error(error.message);
      } else {
        // Fallback for truly unknown errors
        console.error("[submitQuote] Unknown error format:", JSON.stringify(error));
        toast.error(
          <div className="flex flex-col gap-2">
            <div className="font-medium">Unknown Error</div>
            <div className="text-sm">
              Failed to submit quote. Error details have been logged to the console.
            </div>
          </div>,
          { duration: 8000 }
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function stopGeneration() {
    // Invalidate current runId and poolId so any responses are ignored
    const oldRunId = currentRunIdRef.current;
    const oldPoolId = currentPoolIdRef.current;
    currentRunIdRef.current = null;
    currentPoolIdRef.current = null;
    console.log(`🛑 Invalidated runId: ${oldRunId}, poolId: ${oldPoolId}`);
    
    // Abort the current fetch request if it's running
    if (abortControllerRef.current) {
      console.log('🛑 Aborting current AI request...');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Remove the last user message from the database and UI
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const lastUserMessageTimestamp = lastUserMessage?.created_at;
    
    if (lastUserMessage) {
      try {
        console.log('🗑️ Deleting user message:', lastUserMessage.id);
        
        // Store the timestamp in localStorage so we can clean up orphaned messages later
        // (Backend might still write messages after we navigate away)
        if (lastUserMessageTimestamp) {
          const stoppedMessages = JSON.parse(localStorage.getItem('stoppedMessages') || '{}');
          stoppedMessages[projectId] = lastUserMessageTimestamp;
          localStorage.setItem('stoppedMessages', JSON.stringify(stoppedMessages));
          stoppedMessageTimestamp.current = lastUserMessageTimestamp;
          console.log('📝 Stored stopped message timestamp for future cleanup');
        }
        
        // Delete from database
        await supabase
          .from("chat_messages")
          .delete()
          .eq("id", lastUserMessage.id);
        
        // Remove from UI
        setMessages(prev => prev.filter(m => m.id !== lastUserMessage.id));
      } catch (error) {
        console.error('Error removing message:', error);
      }
    }
    
    // The global cleanup interval will handle orphaned messages
    // No need for component-specific polling that gets interrupted
    console.log('✅ Stop complete - global cleanup will handle any orphaned messages');
    
    // Clear suggested products and working state immediately
    try {
      console.log('🧹 Clearing working state from stopped generation...');
      
      // Clear suggested products from UI
      setSuggestedProducts([]);
      
      // Delete entire working state to ensure clean slate
      await supabase
        .from("project_working_state")
        .delete()
        .eq("project_id", projectId);
      
      console.log('✅ Working state cleared');
    } catch (error) {
      console.error('Error clearing working state:', error);
    }
    
    // Restore the last sent message to the input
    setInput(lastSentMessage);
    setLoading(false);
    
    // Focus the input
    if (textareaRef.current) {
      textareaRef.current.focus();
      // Auto-resize the textarea
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
    
    toast.success("Generation stopped - you can edit and resend");
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage: Partial<ChatMessage> = {
      project_id: projectId,
      role: "user",
      content: input.trim(),
      metadata: {},
    };

    setLoading(true);
    const currentInput = input;
    setLastSentMessage(currentInput);
    setInput("");
    
    // Reset textarea height to single line
    if (textareaRef.current) {
      textareaRef.current.style.height = '20px';
    }

    // Activate split view after first user message
    const isFirstMessage = messages.filter(m => m.role === 'user').length === 0;
    if (isFirstMessage) {
      setShowSplitView(true);
    }

    // Generate unique runId for this request
    const runId = `${projectId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    currentRunIdRef.current = runId;
    
    // Generate unique poolId for this search/pool - ensures complete isolation
    const poolId = `pool-${projectId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    currentPoolIdRef.current = poolId;
    
    // Generate contextId for this turn (session isolation)
    const contextId = `ctx-${poolId}`;
    
    console.log(`🎯 === NEW TURN START === { projectId: "${projectId}", contextId: "${contextId}", poolId: "${poolId}", runId: "${runId}" }`);
    console.log(`🎯 Turn initial state: { suggestedProducts: ${suggestedProducts.length}, quotePreview: ${quotePreview?.line_items?.length || 0} items }`);
    console.log(`🏊 pool:start { poolId: "${poolId}", runId: "${runId}", query: "${currentInput.substring(0, 50)}..." }`);

    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Save user message
      const { data: userMsg, error: userError } = await supabase
        .from("chat_messages")
        .insert(userMessage)
        .select()
        .single();

      if (userError) throw userError;
      if (userMsg) {
        setMessages((prev) => [...prev, userMsg]);
      }

      // Track analytics
      await trackAIChatMessage(projectId, currentInput.length);

      // CRITICAL: Strip product suggestions from chat history to prevent context bleed
      // The AI should ONLY work with current working state, not old chat memory
      const sanitizedHistory = messages.slice(-10).map(msg => {
        // Keep only the conversational text, remove any product data
        let content = msg.content;
        
        // Remove product lists from assistant messages (lines starting with numbers or bullets)
        if (msg.role === 'assistant') {
          // Remove structured product lists but keep conversational responses
          const lines = content.split('\n');
          const cleanedLines = lines.filter(line => {
            const trimmed = line.trim();
            // Filter out lines that look like product listings
            return !trimmed.match(/^\d+\.|^[-•*]\s|^Product:|^Item:/i);
          });
          content = cleanedLines.join('\n').trim();
        }
        
        return {
          role: msg.role,
          content: content || 'Product search completed.'
        };
      });
      
      // Determine current quote line count safely
      const quoteLineCount = quotePreview?.line_items?.length ?? 0;
      
      // Pass ONLY current working state as source of truth
      const currentWorkingState = {
        suggestedProducts: suggestedProducts.filter(p => p.poolId === poolId), // Only current pool products
        quotePreview: quotePreview,
        hasExistingProducts: suggestedProducts.length > 0,
        hasExistingQuote: quoteLineCount > 0
      };

      console.log(`🔒 context:isolated { contextId: "${contextId}", workingProducts: ${currentWorkingState.suggestedProducts.length}, quoteLines: ${currentWorkingState.hasExistingQuote ? quoteLineCount : 0} }`);

      // Call AI API with abort signal, runId, and poolId
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          message: currentInput,
          history: sanitizedHistory, // Sanitized history without product data
          runId, // Send runId for validation
          poolId, // Send poolId for product isolation
          contextId, // Session isolation
          currentState: currentWorkingState, // ONLY source of truth for products
          clearContext: true, // Instruct AI to not use memory from previous sessions
        }),
        signal: abortController.signal,
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || "Failed to get AI response");
      }

      // CRITICAL: Validate response matches current run and pool (pool bleed protection)
      if (responseData.runId !== currentRunIdRef.current) {
        console.warn(`⚠️ 🏊 pool:blockedHistoryMerge { reason: "runId mismatch", expected: "${currentRunIdRef.current}", got: "${responseData.runId}" }`);
        return; // Silently ignore - this is from an old/stopped run
      }
      
      if (responseData.poolId !== currentPoolIdRef.current) {
        console.warn(`⚠️ 🏊 pool:blockedHistoryMerge { reason: "poolId mismatch", expected: "${currentPoolIdRef.current}", got: "${responseData.poolId}" }`);
        return; // Silently ignore - this is from a different pool
      }
      
      // Check if user switched projects - if so, save to DB but don't update UI
      const userSwitchedProjects = currentProjectId.current !== projectId;
      if (userSwitchedProjects) {
        console.log(`🔄 [Background] User switched projects. Saving results to DB for project: ${projectId}`);
      } else {
        console.log(`✅ Response validated for run: ${runId}, pool: ${poolId}`);
      }

      const aiResponse = responseData.message;
      const products = responseData.products || [];

      // CRITICAL: If AI suggested products, REPLACE the suggested products list completely
      // This is a fresh pool - NO products from previous pools should remain
      if (products.length > 0) {
        console.log(`🎯 suggest:start { projectId: "${projectId}", contextId: "${contextId}", poolId: "${poolId}", count: ${products.length} }`);
        console.log(`🏊 pool:products { poolId: "${poolId}", count: ${products.length}, products: [${products.map((p: any) => p.product_name).join(', ')}] }`);
        
        // Tag products with current poolId and contextId for isolation
        const productsWithIdsAndPool = products.map((p: any, idx: number) => ({
          ...p,
          id: `${poolId}-${idx}`, // Include poolId in ID for uniqueness
          poolId: poolId, // Tag with current pool
          contextId: contextId, // Tag with current context for strict isolation
          selected: false,
          // Canonical key for deduplication (use product_name as key)
          canonicalKey: p.product_id || p.product_name?.toLowerCase().trim() || `${idx}`
        }));
        
        // Deduplicate by canonical key
        const seen = new Set();
        const droppedDuplicates: string[] = [];
        const deduped = productsWithIdsAndPool.filter((p: any) => {
          if (seen.has(p.canonicalKey)) {
            droppedDuplicates.push(p.product_name);
            console.log(`🏊 dedupe:dropped { contextId: "${contextId}", ids: ["${p.id}"], product: "${p.product_name}", reason: "duplicate" }`);
            return false;
          }
          seen.add(p.canonicalKey);
          return true;
        });
        
        // Additional guard: Filter out products already in quote preview (prevent re-suggesting)
        const quoteProductKeys = new Set(
          quotePreview?.line_items?.map((item: any) => 
            item.canonicalKey || item.product_name?.toLowerCase().trim()
          ) || []
        );
        
        const finalProducts = deduped.filter((p: any) => {
          if (quoteProductKeys.has(p.canonicalKey)) {
            console.log(`🚫 blockedHistoryMerge { fromContext: "quote_preview", intoContext: "${contextId}", product: "${p.product_name}", reason: "already in quote" }`);
            droppedDuplicates.push(p.product_name);
            return false;
          }
          return true;
        });
        
        // Only update UI state if user is still on this project
        if (!userSwitchedProjects) {
          // ATOMIC REPLACEMENT: Clear ALL previous products and set ONLY current context products
          // This is STATELESS - no carry-over from previous turns
          const oldCount = suggestedProducts.length;
          setSuggestedProducts(finalProducts);
          setSelectAll(false);
          
          console.log(`🎯 suggest:render { contextId: "${contextId}", count: ${finalProducts.length}, dropped: ${droppedDuplicates.length} }`);
          console.log(`🏊 pool:replaced { poolId: "${poolId}", oldCount: ${oldCount}, newCount: ${finalProducts.length} }`);
          
          // Show the split view when products arrive
          setShowSplitView(true);
          // Auto-switch to suggested products tab when new products arrive
          setActiveTab("suggested");
        } else {
          // User switched projects - save to DB for when they return
          console.log(`🔄 [Background] Saving ${finalProducts.length} products to DB for later retrieval`);
          // Save working state with products for this project
          await supabase
            .from("project_working_state")
            .upsert({
              project_id: projectId,
              suggested_products: finalProducts,
              quote_preview: quotePreview,
              show_split_view: true,
              current_pool_id: poolId
            }, { onConflict: 'project_id' });
        }
      } else {
        // No products in this turn
        if (!userSwitchedProjects) {
          console.log(`🎯 suggest:render { contextId: "${contextId}", count: 0, reason: "no products in response" }`);
          setSuggestedProducts([]);
        }
      }

      // Save AI response
      const assistantMessage: Partial<ChatMessage> = {
        project_id: projectId,
        role: "assistant",
        content: aiResponse,
        metadata: {},
      };

      const { data: aiMsg, error: aiError } = await supabase
        .from("chat_messages")
        .insert(assistantMessage)
        .select()
        .single();

      if (aiError) throw aiError;
      if (aiMsg && !userSwitchedProjects) {
        // Only update messages state if user is still on this project
        setMessages((prev) => [...prev, aiMsg]);
      }
      
      if (userSwitchedProjects) {
        console.log(`🔄 [Background] AI response saved to DB. Will be loaded when user returns to project.`);
      }
    } catch (error: any) {
      // Don't show error toast if the request was aborted (user clicked stop)
      if (error.name === 'AbortError') {
        console.log('Request was aborted by user');
      } else {
        toast.error(error.message || "Failed to send message");
        setInput(currentInput);
      }
    } finally {
      // Clean up abort controller reference
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setLoading(false);
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Render message content with formatting
  function renderMessageContent(content: string) {
    const lines = content.split('\n');
    
    return lines.map((line, index) => {
      // Remove any ### headers that might slip through
      if (line.trim().startsWith('###')) {
        const headerText = line.replace(/^#+\s*/, '').trim();
        return (
          <div key={index} className="font-bold text-gray-900 mt-2 mb-1">
            {headerText}
          </div>
        );
      }
      
      // Checkmarks
      if (line.trim().startsWith('✓')) {
        return (
          <div key={index} className="flex gap-2 ml-2 mb-1">
            <span className="text-green-600 font-bold">✓</span>
            <span>{line.replace(/^[\s✓]+/, '')}</span>
          </div>
        );
      }
      
      // Bold text
      if (line.includes('**')) {
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <p key={index} className="mb-1">
            {parts.map((part, i) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} className="font-bold text-gray-900">{part.slice(2, -2)}</strong>;
              }
              return <span key={i}>{part}</span>;
            })}
          </p>
        );
      }
      
      return <div key={index}>{line || '\u00A0'}</div>;
    });
  }

  return (
    <div className="flex h-full bg-white">
      {/* ARIA live region for edit mode announcements */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {editMode && `Edit mode enabled for ${editQuoteName}, version ${editVersion} to ${editVersion! + 1}`}
        {!editMode && "Edit mode disabled"}
      </div>
      
      {/* Left Side - Chat */}
      <div className={`flex flex-col bg-white transition-all duration-300 ${showSplitView ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
        {/* Chat Header with Clear Button and Edit Indicator */}
        {(messages.length > 1 || editMode) && (
          <div className="border-b border-gray-200 bg-white flex justify-between items-center px-4 py-2.5">
            {/* Edit Mode Indicator */}
            {editMode && editSessionId && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs font-medium text-amber-800">
                <Edit2 size={12} />
                <span>Editing v{editVersion} → v{editVersion! + 1}</span>
              </div>
            )}
            
            {!editMode && <div />}
            
            {/* Actions */}
            <div className="flex items-center gap-2">
              {editMode && (
                <button
                  onClick={async () => {
                    if (confirm('Cancel editing? Unsaved changes will be lost.')) {
                      console.log('[EditUI] ui:edit:exit { quoteId:', editQuoteId, 'session:', editSessionId, 'reason: user-cancelled-header }');
                      const { cancelEditSession } = await import("@/lib/editSessionController");
                      await cancelEditSession(editSessionId!);
                      setEditMode(false);
                      setEditSessionId(null);
                      setEditQuoteId(null);
                      setEditVersion(null);
                      setEditQuoteName(null);
                      setQuotePreview(null);
                      setShowSplitView(false);
                      toast.success("Edit cancelled");
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                  title="Cancel editing"
                >
                  Cancel Edit
                </button>
              )}
              {messages.length > 1 && (
                <button
                  onClick={clearChat}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  title="Clear chat and start over"
                >
                  <RotateCcw size={14} />
                  <span>Clear Chat</span>
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && !loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-5 py-4 bg-white border border-gray-200">
                <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  Welcome to the {projectName} project! I'm here to help you create a professional quote.
                  
                  To get started, please describe the scope of work for this project. What services or products does the client need?
                </div>
              </div>
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                  message.role === "user"
                    ? "bg-[#f4f4f4] text-gray-900"
                    : "bg-white border border-gray-200"
                }`}
              >
                <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {renderMessageContent(message.content)}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start items-start gap-3">
              <div className="bg-white border border-gray-200 rounded-2xl px-5 py-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-blue-500 animate-pulse" />
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                  </div>
                </div>
              </div>
              <button
                onClick={stopGeneration}
                className="mt-1 p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                title="Stop generating"
              >
                <div className="w-3 h-3 bg-gray-700 rounded-sm"></div>
              </button>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="flex gap-3 items-center bg-[#f4f4f4] rounded-3xl px-4 py-2">
            <button className="p-2 hover:bg-gray-300 rounded-lg transition-colors flex-shrink-0">
              <Plus size={20} className="text-gray-600" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Message..."
              disabled={loading}
              className="flex-1 bg-transparent border-none outline-none resize-none text-[15px] placeholder-gray-500 disabled:opacity-50 overflow-hidden leading-tight"
              style={{ height: '20px', maxHeight: '160px' }}
            />
            <button className="p-2 hover:bg-gray-300 rounded-lg transition-colors flex-shrink-0">
              <Mic size={20} className="text-gray-600" />
            </button>
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="p-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Right Side - Suggested Products / Preview */}
      {showSplitView && (
        <div className="w-1/2 flex flex-col bg-gray-50">
          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 bg-white">
            <button
              onClick={() => setActiveTab("suggested")}
              className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "suggested"
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Suggested Products
            </button>
            <button
              onClick={() => setActiveTab("preview")}
              className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "preview"
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Preview
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "suggested" ? (
              <div>
                {suggestedProducts.length === 0 ? (
                  <div className="text-center text-gray-500 mt-12">
                    <FileText size={48} className="mx-auto mb-4 text-gray-300" />
                    <p className="text-sm">No products suggested yet.</p>
                    <p className="text-xs mt-2">Continue chatting to build your quote.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-900">Products to Add</h3>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">Select All</span>
                      </label>
                    </div>
                    <div className="space-y-2">
                      {suggestedProducts.map((product) => (
                        <div
                          key={product.id}
                          onClick={() => toggleProductSelection(product.id!)}
                          className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            product.selected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="font-medium text-gray-900">{product.product_name}</h4>
                            <span className="font-semibold text-gray-900">${formatCurrency(product.line_total)}</span>
                          </div>
                          {product.description && (
                            <p className="text-sm text-gray-600 mb-2">{product.description}</p>
                          )}
                          <div className="flex gap-4 text-xs text-gray-500">
                            <span>Qty: {product.quantity}{product.quantity_unit ? ` ${product.quantity_unit}` : ''}</span>
                            <span>Unit Price: ${formatCurrency(product.unit_price)}{product.price_unit ? ` per ${product.price_unit}` : ''}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-4">
                      <button
                        onClick={applyChangesToQuote}
                        disabled={applyingChanges || selectedCount === 0}
                        className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {applyingChanges 
                          ? "Applying..." 
                          : selectedCount > 0 
                            ? `Apply ${selectedCount} Product${selectedCount > 1 ? 's' : ''} to Quote`
                            : "Select Products to Apply"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {!quotePreview ? (
                  <div className="text-center text-gray-500 mt-12">
                    <FileText size={48} className="mx-auto mb-4 text-gray-300" />
                    <p className="text-sm">No preview available yet.</p>
                    <p className="text-xs mt-2">Apply changes to see the quote preview.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <h3 className="text-lg font-semibold mb-4">Quote Preview</h3>
                      
                      {/* Line Items */}
                      <div className="space-y-3 mb-6">
                        {(!quotePreview.line_items || quotePreview.line_items.length === 0) ? (
                          <div className="text-center text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
                            <p className="text-sm font-medium">⚠️ No line items found</p>
                            <p className="text-xs mt-1">The quote preview is missing line items. Check the console for debugging info.</p>
                          </div>
                        ) : (
                          quotePreview.line_items.map((item, index) => (
                          <div
                            key={index}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, index)}
                            onDragEnd={handleDragEnd}
                            className={`group bg-gray-50 rounded-lg p-4 border-2 transition-all cursor-move ${
                              draggedIndex === index
                                ? 'opacity-50 border-blue-400'
                                : dragOverIndex === index
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="flex gap-3">
                              {/* Drag handle */}
                              <div className="flex items-center cursor-grab active:cursor-grabbing">
                                <GripVertical size={20} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
                              </div>

                              {/* Product info */}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 mb-1">{item.product_name}</div>
                                {editingQuantityIndex === index ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600">Qty:</span>
                                    <input
                                      type="number"
                                      value={tempQuantity}
                                      onChange={(e) => setTempQuantity(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          saveEditedQuantity(index);
                                        } else if (e.key === 'Escape') {
                                          cancelEditingQuantity();
                                        }
                                      }}
                                      className="w-20 px-2 py-1 border border-blue-500 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      autoFocus
                                      step="0.01"
                                      min="0.01"
                                    />
                                    {item.quantity_unit && <span className="text-sm text-gray-600">{item.quantity_unit}</span>}
                                    <button
                                      onClick={() => saveEditedQuantity(index)}
                                      className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={cancelEditingQuantity}
                                      className="px-2 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <span>
                                      Qty: {item.quantity}{item.quantity_unit ? ` ${item.quantity_unit}` : ''} × ${formatCurrency(item.unit_price)}{item.price_unit ? ` per ${item.price_unit}` : ''}
                                    </span>
                                    <button
                                      onClick={() => startEditingQuantity(index, item.quantity)}
                                      className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Edit quantity"
                                    >
                                      <Edit2 size={14} className="text-blue-600" />
                                    </button>
                                  </div>
                                )}

                                {/* Discount Field */}
                                {editingDiscountIndex === index ? (
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-gray-600">Discount:</span>
                                    <input
                                      type="number"
                                      value={tempDiscount}
                                      onChange={(e) => setTempDiscount(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          saveEditedDiscount(index);
                                        } else if (e.key === 'Escape') {
                                          cancelEditingDiscount();
                                        }
                                      }}
                                      className="w-16 px-2 py-1 border border-blue-500 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      autoFocus
                                      step="0.1"
                                      min="0"
                                      max="100"
                                    />
                                    <span className="text-xs text-gray-600">%</span>
                                    <button
                                      onClick={() => saveEditedDiscount(index)}
                                      className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={cancelEditingDiscount}
                                      className="px-2 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                                    <span>
                                      Discount: {item.discount_percent ? `${(item.discount_percent * 100).toFixed(1)}%` : '0%'}
                                    </span>
                                    <button
                                      onClick={() => startEditingDiscount(index, item.discount_percent || 0)}
                                      className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Edit discount"
                                    >
                                      <Edit2 size={12} className="text-blue-600" />
                                    </button>
                                  </div>
                                )}
                                
                                {/* Baked Markup Indicator */}
                                {((item as any)._uiIncludesMarkup > 0 || (item.bakedAdjustments?.markupTotal || 0) > 0) && (
                                  <div className="text-xs text-gray-500 mt-1 italic">
                                    <span 
                                      className="cursor-help"
                                      title={`Markup breakdown: ${(item.bakedAdjustments?.breakdown || []).map(b => {
                                        const config = (quotePreview.bakedMarkups || []).find(m => m.id === b.markupId);
                                        const descriptor = (config?.calculationMode === 'amount' && config?.lumpSumAmount)
                                          ? `$${formatCurrency(config.lumpSumAmount)}`
                                          : `${((config?.percent || 0) * 100).toFixed(1)}%`;
                                        return `${config?.label || 'Unknown'}: +$${formatCurrency(b.delta)} (${descriptor})`;
                                      }).join(', ')}`}
                                    >
                                      Includes Markup: +${formatCurrency((item as any)._uiIncludesMarkup || item.bakedAdjustments?.markupTotal || 0)}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Price and delete */}
                              <div className="flex items-start gap-3">
                                <div className="font-medium text-gray-900 text-right">
                                  ${formatCurrency(item.line_total)}
                                </div>
                                <button
                                  onClick={() => {
                                    if (confirm(`Remove "${item.product_name}" from quote?`)) {
                                      deletePreviewProduct(index);
                                    }
                                  }}
                                  className="p-1.5 hover:bg-red-100 rounded transition-colors opacity-0 group-hover:opacity-100"
                                  title="Delete product"
                                >
                                  <Trash2 size={16} className="text-red-600" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )))}
                      </div>
                      
                      {/* Totals */}
                      <div className="space-y-2 pt-4 border-t-2 border-gray-300">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium">${formatCurrency(quotePreview.subtotal)}</span>
                        </div>
                        
                        {/* Charges Section */}
                        {(() => {
                          console.log('[Preview] Rendering charges:', {
                            hasCharges: !!quotePreview.charges,
                            chargeCount: quotePreview.charges?.length || 0,
                            charges: quotePreview.charges
                          });
                          return null;
                        })()}
                        {(quotePreview.charges && quotePreview.charges.length > 0) && (
                          <div className="space-y-1.5 pt-2">
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Charges</div>
                            {quotePreview.charges.map((charge, chargeIndex) => (
                              <div key={charge.id || `charge-${chargeIndex}`} className="group flex items-start justify-between text-sm hover:bg-gray-50 p-2 rounded -mx-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-700">{charge.name} ({(charge.rate * 100).toFixed(1)}% of ${formatCurrency(charge.applies_to_total || 0)}):</span>
                                    <button
                                      onClick={() => removeCharge(charge.id)}
                                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity"
                                      title="Remove charge"
                                    >
                                      <Trash2 size={12} className="text-red-600" />
                                    </button>
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    {charge.applies_to === 'all' && `Includes: all ${charge.applies_to_count || 0} items`}
                                    {charge.applies_to === 'exclude_products' && charge.excluded_products && charge.excluded_products.length > 0 && (
                                      `Excludes: ${charge.excluded_products.join(', ')}`
                                    )}
                                  </div>
                                </div>
                                <span className="font-medium">${formatCurrency(charge.calculated_amount || 0)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* Baked Markups Section */}
                        {(quotePreview.bakedMarkups && quotePreview.bakedMarkups.length > 0) && (
                          <div className="space-y-1.5 pt-2">
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Baked Markups</div>
                            {quotePreview.bakedMarkups.map((markup, markupIndex) => (
                              <div key={markup.id || `markup-${markupIndex}`} className="group flex items-start justify-between text-sm hover:bg-purple-50 p-2 rounded -mx-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-700">
                                      {markup.label} (
                                      {markup.calculationMode === 'amount' && markup.lumpSumAmount
                                        ? `$${formatCurrency(markup.lumpSumAmount)}`
                                        : `${((markup.percent || 0) * 100).toFixed(1)}%`}
                                      ):
                                    </span>
                                    <button
                                      onClick={() => editBakedMarkup(markup.id)}
                                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-purple-100 rounded transition-opacity"
                                      title="Edit markup"
                                    >
                                      <Edit2 size={12} className="text-purple-600" />
                                    </button>
                                    <button
                                      onClick={() => removeBakedMarkup(markup.id)}
                                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity"
                                      title="Delete markup"
                                    >
                                      <Trash2 size={12} className="text-red-600" />
                                    </button>
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    Base: {markup.audited?.base ? `$${formatCurrency(markup.audited.base)}` : 'N/A'} → 
                                    Affects {Object.keys(markup.audited?.perItemDeltas || {}).length} items
                                  </div>
                                </div>
                                <span className="font-medium">${formatCurrency(markup.audited?.totalMarkup || 0)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* Add Tax and Markup Buttons */}
                        <div className="flex gap-4">
                          <button
                            onClick={() => setShowChargeConfig(true)}
                            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium py-1"
                          >
                            <Plus size={14} />
                            Add Tax
                          </button>
                          <button
                            onClick={() => setShowMarkupConfig(true)}
                            className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-700 font-medium py-1"
                          >
                            <Plus size={14} />
                            Add Markup
                          </button>
                        </div>
                        
                        {quotePreview.discount_amount > 0 && (
                          <div className="flex justify-between text-sm text-green-600">
                            <span>Discount:</span>
                            <span className="font-medium">-${formatCurrency(quotePreview.discount_amount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                          <span>Total:</span>
                          <span>${formatCurrency(quotePreview.total_price)}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Change Notes (Edit Mode Only) */}
                    {editMode && (
                      <div className="pt-4 border-t border-gray-200">
                        <button
                          onClick={() => setShowChangeNotes(!showChangeNotes)}
                          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors mb-2"
                        >
                          <FileText size={14} />
                          <span>{showChangeNotes ? 'Hide' : 'Add'} change notes (optional)</span>
                        </button>
                        
                        {showChangeNotes && (
                          <textarea
                            value={changeNotes}
                            onChange={(e) => setChangeNotes(e.target.value)}
                            placeholder="Describe what changed in this version..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            rows={3}
                          />
                        )}
                      </div>
                    )}
                    
                    {/* Action Buttons */}
                    <div className="space-y-2">
                      <button
                        onClick={submitQuote}
                        disabled={submitting}
                        className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                      >
                        <CheckCircle size={18} />
                        {submitting ? "Submitting..." : editMode ? `Save as v${editVersion! + 1}` : "Submit Quote"}
                      </button>
                      
                      {editMode && (
                        <button
                          onClick={async () => {
                            if (confirm('Cancel editing? Unsaved changes will be lost.')) {
                              console.log('[EditUI] ui:edit:exit { quoteId:', editQuoteId, 'session:', editSessionId, 'reason: user-cancelled }');
                              const { cancelEditSession } = await import("@/lib/editSessionController");
                              await cancelEditSession(editSessionId!);
                              setEditMode(false);
                              setEditSessionId(null);
                              setEditQuoteId(null);
                              setEditVersion(null);
                              setEditQuoteName(null);
                              setQuotePreview(null);
                              setShowSplitView(false);
                              toast.success("Edit cancelled");
                            }
                          }}
                          className="w-full py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          Cancel Edit
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Charge Configuration Modal */}
      {showChargeConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowChargeConfig(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Add Tax/Charge</h3>
                <button onClick={() => setShowChargeConfig(false)} className="text-gray-400 hover:text-gray-600">
                  ×
                </button>
              </div>
              
              {/* Charge Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Charge Name</label>
                <input
                  type="text"
                  value={currentCharge.name}
                  onChange={(e) => setCurrentCharge({...currentCharge, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Sales Tax"
                />
              </div>
              
              {/* Percentage */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Percentage (%)</label>
                <input
                  type="number"
                  value={currentCharge.rate}
                  onChange={(e) => setCurrentCharge({...currentCharge, rate: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 9.5"
                  step="0.1"
                  min="0"
                />
              </div>
              
              {/* Applies To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Applies To</label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={currentCharge.appliesTo === 'all'}
                      onChange={() => setCurrentCharge({...currentCharge, appliesTo: 'all', selectedProducts: []})}
                      className="mr-2"
                    />
                    <span className="text-sm">All items</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={currentCharge.appliesTo === 'exclude_products'}
                      onChange={() => setCurrentCharge({...currentCharge, appliesTo: 'exclude_products'})}
                      className="mr-2"
                    />
                    <span className="text-sm">Exclude...</span>
                  </label>
                </div>
              </div>
              
              {/* Product Selection */}
              {currentCharge.appliesTo === 'exclude_products' && quotePreview && (
                <div className="pl-6 space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  {quotePreview.line_items.map((item, index) => (
                    <label key={index} className="flex items-start">
                      <input
                        type="checkbox"
                        checked={currentCharge.selectedProducts.includes(item.product_name)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCurrentCharge({
                              ...currentCharge,
                              selectedProducts: [...currentCharge.selectedProducts, item.product_name]
                            });
                          } else {
                            setCurrentCharge({
                              ...currentCharge,
                              selectedProducts: currentCharge.selectedProducts.filter(p => p !== item.product_name)
                            });
                          }
                        }}
                        className="mr-2 mt-0.5"
                      />
                      <div className="flex-1">
                        <span className="text-sm">{item.product_name}</span>
                        <span className="text-xs text-gray-500 ml-2">(${formatCurrency(item.line_total)})</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              
              {/* Preview */}
              {currentCharge.rate && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-sm text-blue-900">
                    <strong>Preview:</strong> Applies to {calculateChargePreview().count} items totaling ${formatCurrency(calculateChargePreview().total)}
                  </div>
                  <div className="text-xs text-blue-700 mt-1">
                    Charge amount: ${formatCurrency(calculateChargePreview().total * (parseFloat(currentCharge.rate) / 100 || 0))}
                  </div>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowChargeConfig(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={addChargeToQuote}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Add Charge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Baked Markup Configuration Modal */}
      {showMarkupConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => { setShowMarkupConfig(false); setEditingMarkupId(null); }}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{editingMarkupId ? 'Edit' : 'Add'} Markup (baked)</h3>
                <button onClick={() => { setShowMarkupConfig(false); setEditingMarkupId(null); }} className="text-gray-400 hover:text-gray-600">
                  ×
                </button>
              </div>
              
              {/* Markup Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Charge Name</label>
                <input
                  type="text"
                  value={currentMarkup.name}
                  onChange={(e) => setCurrentMarkup({...currentMarkup, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., Markup"
                />
              </div>
              
              {/* Percentage */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Percentage (%)</label>
                <input
                  type="number"
                  value={currentMarkup.rate}
                  onChange={(e) => setCurrentMarkup({...currentMarkup, rate: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., 7.5"
                  step="0.1"
                  min="0"
                />
              </div>
              
              {/* Lump Sum */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lump Sum ($)</label>
                <input
                  type="number"
                  value={currentMarkup.lumpSum}
                  onChange={(e) => setCurrentMarkup({ ...currentMarkup, lumpSum: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., 2000"
                  step="0.01"
                  min="0"
                />
                <p className="text-xs text-gray-500 mt-1">Enter a fixed amount instead of a percentage.</p>
              </div>
              
              {/* Base Applies To */}
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Base Applies To</label>
                <p className="text-xs text-gray-500 mb-2">Items used to calculate the markup amount</p>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={currentMarkup.baseAppliesTo === 'all'}
                      onChange={() => setCurrentMarkup({...currentMarkup, baseAppliesTo: 'all', baseSelectedProducts: []})}
                      className="mr-2"
                    />
                    <span className="text-sm">All items</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={currentMarkup.baseAppliesTo === 'exclude_products'}
                      onChange={() => setCurrentMarkup({...currentMarkup, baseAppliesTo: 'exclude_products'})}
                      className="mr-2"
                    />
                    <span className="text-sm">Exclude...</span>
                  </label>
                </div>
              </div>
              
              {/* Base Product Selection */}
              {currentMarkup.baseAppliesTo === 'exclude_products' && quotePreview && (
                <div className="pl-6 space-y-2 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
                  {quotePreview.line_items.map((item, index) => (
                    <label key={index} className="flex items-start">
                      <input
                        type="checkbox"
                        checked={currentMarkup.baseSelectedProducts.includes(item.product_name)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCurrentMarkup({
                              ...currentMarkup,
                              baseSelectedProducts: [...currentMarkup.baseSelectedProducts, item.product_name]
                            });
                          } else {
                            setCurrentMarkup({
                              ...currentMarkup,
                              baseSelectedProducts: currentMarkup.baseSelectedProducts.filter(p => p !== item.product_name)
                            });
                          }
                        }}
                        className="mr-2 mt-0.5"
                      />
                      <div className="flex-1">
                        <span className="text-sm">{item.product_name}</span>
                        <span className="text-xs text-gray-500 ml-2">(${formatCurrency(item.line_total)})</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              
              {/* Add To */}
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Add To</label>
                <p className="text-xs text-gray-500 mb-2">Items that will receive the markup baked into their prices</p>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={currentMarkup.addToAppliesTo === 'all'}
                      onChange={() => setCurrentMarkup({...currentMarkup, addToAppliesTo: 'all', addToSelectedProducts: []})}
                      className="mr-2"
                    />
                    <span className="text-sm">All items</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={currentMarkup.addToAppliesTo === 'exclude_products'}
                      onChange={() => setCurrentMarkup({...currentMarkup, addToAppliesTo: 'exclude_products'})}
                      className="mr-2"
                    />
                    <span className="text-sm">Exclude...</span>
                  </label>
                </div>
              </div>
              
              {/* Add To Product Selection */}
              {currentMarkup.addToAppliesTo === 'exclude_products' && quotePreview && (
                <div className="pl-6 space-y-2 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
                  {quotePreview.line_items.map((item, index) => (
                    <label key={index} className="flex items-start">
                      <input
                        type="checkbox"
                        checked={currentMarkup.addToSelectedProducts.includes(item.product_name)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCurrentMarkup({
                              ...currentMarkup,
                              addToSelectedProducts: [...currentMarkup.addToSelectedProducts, item.product_name]
                            });
                          } else {
                            setCurrentMarkup({
                              ...currentMarkup,
                              addToSelectedProducts: currentMarkup.addToSelectedProducts.filter(p => p !== item.product_name)
                            });
                          }
                        }}
                        className="mr-2 mt-0.5"
                      />
                      <div className="flex-1">
                        <span className="text-sm">{item.product_name}</span>
                        <span className="text-xs text-gray-500 ml-2">(${formatCurrency(item.line_total)})</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              
              {/* Advanced Options */}
              <div className="border-t pt-4">
                <button
                  onClick={() => setCurrentMarkup({...currentMarkup, showAdvanced: !currentMarkup.showAdvanced})}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  <span>{currentMarkup.showAdvanced ? '▼' : '▶'}</span>
                  <span>Advanced</span>
                </button>
                
                {currentMarkup.showAdvanced && (
                  <div className="mt-3 pl-6 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Distribution</label>
                      <div className="space-y-2">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            checked={currentMarkup.distribution === 'proportional'}
                            onChange={() => setCurrentMarkup({...currentMarkup, distribution: 'proportional'})}
                            className="mr-2"
                          />
                          <span className="text-sm">Proportional (based on line totals)</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            checked={currentMarkup.distribution === 'even'}
                            onChange={() => setCurrentMarkup({...currentMarkup, distribution: 'even'})}
                            className="mr-2"
                          />
                          <span className="text-sm">Even (equal shares)</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            checked={currentMarkup.distribution === 'single'}
                            onChange={() => setCurrentMarkup({...currentMarkup, distribution: 'single', singleItemIndex: 0})}
                            className="mr-2"
                          />
                          <span className="text-sm">Single item</span>
                        </label>
                      </div>
                      
                      {/* Single Item Picker */}
                      {currentMarkup.distribution === 'single' && quotePreview && (
                        <div className="mt-2 pl-6">
                          <select
                            value={currentMarkup.singleItemIndex ?? 0}
                            onChange={(e) => setCurrentMarkup({...currentMarkup, singleItemIndex: parseInt(e.target.value)})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                          >
                            {matchItemsBySelector(quotePreview.line_items, currentMarkup.addToAppliesTo, currentMarkup.addToSelectedProducts).map((item, idx) => (
                              <option key={idx} value={idx}>
                                {item.product_name} (${formatCurrency(item.line_total)})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Preview */}
              {(currentMarkup.rate || currentMarkup.lumpSum) && (() => {
                const preview = calculateMarkupPreview();
                return (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="text-sm text-purple-900 space-y-1">
                      <div><strong>Base:</strong> {preview.baseCount} items totaling ${formatCurrency(preview.baseTotal)}</div>
                      <div>
                        <strong>Markup Amount:</strong> ${formatCurrency(preview.markupAmount)}{' '}
                        {preview.mode === 'amount'
                          ? '(lump sum)'
                          : `(${currentMarkup.rate || (preview.effectiveRate * 100).toFixed(2)}%)`}
                      </div>
                      <div><strong>Add To:</strong> {preview.addToCount} items</div>
                      <div className="text-xs text-purple-700 mt-2 italic">
                        The markup will be baked into the selected items' prices
                      </div>
                    </div>
                  </div>
                );
              })()}
              
              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowMarkupConfig(false); setEditingMarkupId(null); }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={addBakedMarkupToQuote}
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium"
                >
                  {editingMarkupId ? 'Update Markup' : 'Add Markup'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

