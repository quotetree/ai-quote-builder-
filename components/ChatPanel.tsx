"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Mic, Plus, Sparkles, TrendingUp, Save, CheckCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ChatMessage } from "@/types/database";
import { trackAIChatMessage } from "@/lib/analytics";
import toast from "react-hot-toast";
import { parseQuoteFromMessage, containsQuote, formatQuoteSummary, parseModificationCommand } from "@/lib/quoteParser";
import { buildConversationContext, generateContextSummary } from "@/lib/conversationContext";

interface ChatPanelProps {
  projectId: string;
  projectName: string;
}

// Helper to detect if message contains a quote
function isQuoteMessage(content: string): boolean {
  return content.includes('QUOTE GENERATED') || content.includes('**Line Items:**');
}

// Helper to parse and format message content
function formatMessageContent(content: string): {
  isQuote: boolean;
  hasRecommendations: boolean;
  formattedContent: string;
} {
  const isQuote = isQuoteMessage(content);
  const hasRecommendations = content.toLowerCase().includes('recommend') || 
                             content.toLowerCase().includes('suggest');
  
  // Format the content with better structure
  let formattedContent = content;
  
  // Add line breaks for better readability
  formattedContent = formattedContent.replace(/\n/g, '\n');
  
  return { isQuote, hasRecommendations, formattedContent };
}

// Helper to render formatted content with basic markdown styling
function renderFormattedContent(content: string) {
  // Split by lines
  const lines = content.split('\n');
  
  return lines.map((line, index) => {
    // Headers
    if (line.startsWith('## ')) {
      return (
        <h3 key={index} className="text-lg font-bold mt-3 mb-2 text-gray-900">
          {line.replace('## ', '')}
        </h3>
      );
    }
    
    // Bold text with **
    if (line.includes('**')) {
      const parts = line.split(/(\*\*.*?\*\*)/g);
      return (
        <p key={index} className="mb-1">
          {parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <strong key={i} className="font-semibold text-gray-900">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return <span key={i}>{part}</span>;
          })}
        </p>
      );
    }
    
    // Bullet points
    if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
      return (
        <div key={index} className="flex gap-2 ml-2 mb-1">
          <span className="text-green-600 font-bold">•</span>
          <span>{line.replace(/^[\s•\-]+/, '')}</span>
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
    
    // Numbered items
    if (/^\d+\./.test(line.trim())) {
      return (
        <div key={index} className="ml-2 mb-1">
          {line}
        </div>
      );
    }
    
    // Table detection (for quotes)
    if (line.includes('|') && (line.includes('Item') || line.includes('---'))) {
      return <div key={index} className="font-mono text-sm">{line}</div>;
    }
    
    // Regular line
    return <div key={index}>{line || '\u00A0'}</div>;
  });
}

export default function ChatPanel({ projectId, projectName }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [committedQuotes, setCommittedQuotes] = useState<Set<string>>(new Set());
  const [committingQuote, setCommittingQuote] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentProjectId = useRef<string | null>(null);
  const hasLoadedMessages = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    let isActive = true;
    
    // Always load messages when projectId changes - don't rely on ref comparison
    // This ensures messages load correctly even with client-side navigation
    const loadMessages = async () => {
      try {
        // Check if we've already loaded messages for this project in this effect
        if (currentProjectId.current === projectId && hasLoadedMessages.current) {
          console.log('Messages already loaded for this project, skipping');
          return;
        }

        // Update tracking refs
        currentProjectId.current = projectId;
        hasLoadedMessages.current = false;
        
        console.log('Loading messages for project:', projectId);
        
        // Show welcome message IMMEDIATELY in UI (optimistic update)
        const welcomeMessage: ChatMessage = {
          id: 'temp-welcome-' + Date.now(),
          project_id: projectId,
          role: 'assistant',
          content: `Welcome to the ${projectName} project! I'm here to help you create a professional quote.\n\nTo get started, please describe the scope of work for this project. What services or products does the client need?`,
          metadata: {},
          created_at: new Date().toISOString()
        };
        setMessages([welcomeMessage]);
        
        // Load messages from database
        const { data, error } = await supabase
          .from("chat_messages")
          .select("id, project_id, role, content, metadata, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .limit(100);

        if (!isActive) return;

        if (error) {
          console.error('Chat load error:', error);
          // Keep showing the welcome message even on error
          // Try to persist it to database in background
          await sendSystemMessageToDb(welcomeMessage.content);
          hasLoadedMessages.current = true;
          return;
        }

        if (data && data.length > 0) {
          // Messages exist, replace the temporary welcome with real messages
          console.log('Loaded', data.length, 'messages from database');
          setMessages(data);
          hasLoadedMessages.current = true;
        } else {
          // No messages exist, persist the welcome message to database in background
          console.log('No existing messages, persisting welcome message');
          await sendSystemMessageToDb(welcomeMessage.content);
          hasLoadedMessages.current = true;
        }
      } catch (error: any) {
        console.error('Chat load error:', error);
        // Keep the welcome message visible even on error
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
    
    loadMessages();
    
    return () => {
      isActive = false;
      // Don't reset refs in cleanup - they should persist across effect runs
    };
  }, [projectId, projectName]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  async function sendSystemMessageToDb(content: string) {
    // Persist welcome message to database in background, don't wait or update UI
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
        // Replace temp message with real database message
        setMessages([data]);
      }
    } catch (error) {
      console.error('Failed to persist welcome message:', error);
      // UI already shows the message, so this is just a background operation
    }
  }

  async function commitQuoteToLog(messageId: string, messageContent: string) {
    setCommittingQuote(messageId);
    
    try {
      // Parse the quote from the message
      const parsedQuote = parseQuoteFromMessage(messageContent, projectName);
      
      if (!parsedQuote) {
        throw new Error("Failed to parse quote data");
      }

      // Get user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Generate quote number
      const { count } = await supabase
        .from("quotes")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId);
      
      const quoteNumber = `Q-${String((count || 0) + 1).padStart(4, '0')}`;

      // Calculate values
      const discount_rate = parsedQuote.discount_amount > 0 
        ? (parsedQuote.discount_amount / parsedQuote.subtotal) * 100 
        : 0;

      // Create quote in database
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
          subtotal: parsedQuote.subtotal,
          tax_rate: parsedQuote.tax_rate,
          tax_amount: parsedQuote.tax_amount,
          discount_rate,
          discount_amount: parsedQuote.discount_amount,
          total_price: parsedQuote.total_price,
          profit_margin: parsedQuote.profit_margin || 0,
        })
        .select()
        .single();

      if (quoteError) throw quoteError;

      // Create quote items
      if (quote && parsedQuote.line_items.length > 0) {
        const quoteItems = parsedQuote.line_items.map((item, index) => ({
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

      // Mark as committed
      setCommittedQuotes(prev => new Set(prev).add(messageId));
      
      // Dispatch custom event to notify LogPanel to refresh quotes
      window.dispatchEvent(new CustomEvent('quoteCreated', { detail: { projectId, quoteId: quote.id } }));
      
      toast.success("Quote committed to Quote Log!");
    } catch (error: any) {
      console.error("Error committing quote:", error);
      toast.error(error.message || "Failed to commit quote");
    } finally {
      setCommittingQuote(null);
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
          history: messages.slice(-10), // Last 10 messages for context
        }),
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        // Show the actual error from the API
        throw new Error(responseData.error || "Failed to get AI response");
      }

      const aiResponse = responseData.message;

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
      // Restore input on error
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

  // Build conversation context for insights
  const conversationContext = buildConversationContext(messages, projectId);
  const contextSummary = generateContextSummary(conversationContext);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl mx-auto w-full">
        {/* Optional: Show context summary for longer conversations */}
        {messages.length > 5 && conversationContext.lastQuoteGenerated && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
            <div className="flex items-center gap-2 text-green-700 font-medium mb-1">
              <Sparkles size={14} />
              <span>Conversation Summary</span>
            </div>
            <div className="text-green-600 text-xs whitespace-pre-line">
              {contextSummary}
            </div>
          </div>
        )}
        
        {messages.map((message) => {
          const { isQuote, hasRecommendations, formattedContent } = formatMessageContent(message.content);
          
          return (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                  message.role === "user"
                    ? "bg-[#f4f4f4] text-gray-900"
                    : isQuote 
                      ? "bg-gradient-to-br from-green-50 to-indigo-50 border-2 border-green-200 shadow-md"
                      : hasRecommendations
                        ? "bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200"
                        : "bg-white border border-gray-200"
                }`}
              >
                {/* AI Badge for special messages */}
                {message.role === "assistant" && (isQuote || hasRecommendations) && (
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-300">
                    {isQuote ? (
                      <>
                        <TrendingUp size={16} className="text-green-600" />
                        <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">
                          Quote Generated
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} className="text-amber-600" />
                        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                          AI Recommendation
                        </span>
                      </>
                    )}
                  </div>
                )}
                
                {/* Message content with markdown-like formatting */}
                <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {renderFormattedContent(formattedContent)}
                </div>

                {/* Commit to Quote Log button for quote messages */}
                {message.role === "assistant" && isQuote && (
                  <div className="mt-4 pt-3 border-t border-green-200">
                    {committedQuotes.has(message.id) ? (
                      <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                        <CheckCircle size={16} />
                        <span>Committed to Quote Log</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => commitQuoteToLog(message.id, message.content)}
                        disabled={committingQuote === message.id}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Save size={16} />
                        {committingQuote === message.id ? "Committing..." : "Commit to Quote Log"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-green-500 animate-pulse" />
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
        <div className="max-w-3xl mx-auto w-full">
          <div className="flex gap-3 items-end bg-[#f4f4f4] rounded-3xl px-4 py-2">
            <button
              className="p-2 hover:bg-gray-300 rounded-lg transition-colors flex-shrink-0"
              title="Add attachment"
            >
              <Plus size={20} className="text-gray-600" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Message..."
              rows={1}
              disabled={loading}
              className="flex-1 bg-transparent border-none outline-none resize-none py-2 text-[15px] placeholder-gray-500 disabled:opacity-50 max-h-32"
              style={{ minHeight: "24px" }}
            />
            <button
              className="p-2 hover:bg-gray-300 rounded-lg transition-colors flex-shrink-0"
              title="Voice input"
            >
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
    </div>
  );
}

