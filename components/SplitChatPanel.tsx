"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Mic, Plus, Sparkles, CheckCircle, FileText, Trash2, Edit2, GripVertical, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ChatMessage, ProductSuggestion, QuotePreview } from "@/types/database";
import { trackAIChatMessage } from "@/lib/analytics";
import toast from "react-hot-toast";

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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentProjectId = useRef<string | null>(null);
  const hasLoadedMessages = useRef(false);
  const isClearing = useRef(false); // Track if we're in the middle of clearing
  const supabase = createClient();

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
        return;
      }

      if (data) {
        console.log('Loaded working state from database');
        setSuggestedProducts(data.suggested_products || []);
        setQuotePreview(data.quote_preview);
        setShowSplitView(data.show_split_view || false);
      }
    } catch (error) {
      console.error('Failed to load working state:', error);
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
          setMessages(messagesData);
          hasLoadedMessages.current = true;
        } else {
          console.log('📭 No existing messages, persisting welcome message');
          await sendSystemMessageToDb(welcomeMessage.content);
          hasLoadedMessages.current = true;
        }

        // Load working state (suggested products and preview)
        await loadWorkingState();
        
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
      // Get existing preview items or start fresh
      const existingItems = quotePreview?.line_items || [];
      
      // Add selected products to existing items
      const allItems = [...existingItems, ...selectedProducts];
      
      // Calculate totals
      const subtotal = allItems.reduce((sum, item) => sum + item.line_total, 0);
      const tax_rate = quotePreview?.tax_rate || 0;
      const tax_amount = subtotal * tax_rate;
      const discount_amount = quotePreview?.discount_amount || 0;
      const total_price = subtotal + tax_amount - discount_amount;

      const preview: QuotePreview = {
        line_items: allItems,
        subtotal,
        tax_rate,
        tax_amount,
        discount_amount,
        total_price
      };

      setQuotePreview(preview);
      
      // Remove selected products from suggested list, keep unselected ones
      setSuggestedProducts(prev => prev.filter(p => !p.selected));
      setSelectAll(false);
      
      setActiveTab("preview");
      toast.success(`Added ${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''} to quote!`);
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
    
    // Recalculate totals
    const subtotal = updatedItems.reduce((sum, item) => sum + item.line_total, 0);
    const tax_amount = subtotal * quotePreview.tax_rate;
    const total_price = subtotal + tax_amount - quotePreview.discount_amount;
    
    setQuotePreview({
      ...quotePreview,
      line_items: updatedItems,
      subtotal,
      tax_amount,
      total_price
    });
    
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

  // Edit quantity for a preview product
  function editPreviewProductQuantity(index: number, newQuantity: number) {
    if (!quotePreview || newQuantity < 0.01) return;
    
    const updatedItems = [...quotePreview.line_items];
    const item = updatedItems[index];
    
    // Update quantity and line total
    item.quantity = newQuantity;
    item.line_total = item.unit_price * newQuantity;
    
    // Recalculate totals
    const subtotal = updatedItems.reduce((sum, item) => sum + item.line_total, 0);
    const tax_amount = subtotal * quotePreview.tax_rate;
    const total_price = subtotal + tax_amount - quotePreview.discount_amount;
    
    setQuotePreview({
      ...quotePreview,
      line_items: updatedItems,
      subtotal,
      tax_amount,
      total_price
    });
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Generate quote number
      const { count } = await supabase
        .from("quotes")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId);
      
      const quoteNumber = `Q-${String((count || 0) + 1).padStart(4, '0')}`;

      // Create quote
      const { data: quote, error: quoteError } = await supabase
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
        })
        .select()
        .single();

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
          discount_percent: 0,
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
      
      toast.success(`Quote ${quoteNumber} saved successfully!`);
    } catch (error: any) {
      console.error("Error submitting quote:", error);
      toast.error(error.message || "Failed to submit quote");
    } finally {
      setSubmitting(false);
    }
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

      // Call AI API
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          message: currentInput,
          history: messages.slice(-10),
        }),
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || "Failed to get AI response");
      }

      const aiResponse = responseData.message;
      const products = responseData.products || [];

      // If AI suggested products, REPLACE the suggested products list (new chat = fresh start)
      if (products.length > 0) {
        // Add unique IDs and default selected state to products
        const productsWithIds = products.map((p: any, idx: number) => ({
          ...p,
          id: `${Date.now()}-${idx}`,
          selected: false
        }));
        setSuggestedProducts(productsWithIds);
        setSelectAll(false);
        // Show the split view when products arrive
        setShowSplitView(true);
        // Auto-switch to suggested products tab when new products arrive
        setActiveTab("suggested");
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
      if (aiMsg) {
        setMessages((prev) => [...prev, aiMsg]);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to send message");
      setInput(currentInput);
    } finally {
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
      {/* Left Side - Chat */}
      <div className={`flex flex-col bg-white transition-all duration-300 ${showSplitView ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
        {/* Chat Header with Clear Button */}
        {messages.length > 1 && (
          <div className="border-b border-gray-200 bg-white flex justify-end">
            <button
              onClick={clearChat}
              className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:text-red-600 hover:bg-red-50 border-b-2 border-transparent rounded-lg transition-colors"
              title="Clear chat and start over"
            >
              <RotateCcw size={16} />
              <span>Clear Chat</span>
            </button>
          </div>
        )}
        
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
            <div className="flex justify-start">
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
                        {quotePreview.line_items.map((item, index) => (
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
                        ))}
                      </div>
                      
                      {/* Totals */}
                      <div className="space-y-2 pt-4 border-t-2 border-gray-300">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium">${formatCurrency(quotePreview.subtotal)}</span>
                        </div>
                        {quotePreview.tax_amount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Tax ({(quotePreview.tax_rate * 100).toFixed(1)}%):</span>
                            <span className="font-medium">${formatCurrency(quotePreview.tax_amount)}</span>
                          </div>
                        )}
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
                    
                    <button
                      onClick={submitQuote}
                      disabled={submitting}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={18} />
                      {submitting ? "Submitting..." : "Submit Quote"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

