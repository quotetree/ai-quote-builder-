"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Mic, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ChatMessage } from "@/types/database";
import { trackAIChatMessage } from "@/lib/analytics";
import toast from "react-hot-toast";

interface ChatPanelProps {
  projectId: string;
  projectName: string;
}

export default function ChatPanel({ projectId, projectName }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentProjectId = useRef<string | null>(null);
  const hasLoadedMessages = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    let isActive = true;
    
    // Only load messages if project has changed or this is the first load
    if (currentProjectId.current !== projectId) {
      currentProjectId.current = projectId;
      hasLoadedMessages.current = false;
      
      // Show welcome message IMMEDIATELY in UI (optimistic update)
      const welcomeMessage: ChatMessage = {
        id: 'temp-welcome',
        project_id: projectId,
        role: 'assistant',
        content: `Welcome to the ${projectName} project! I'm here to help you create a professional quote.\n\nTo get started, please describe the scope of work for this project. What services or products does the client need?`,
        metadata: {},
        created_at: new Date().toISOString()
      };
      setMessages([welcomeMessage]);
      
      // Load messages in the background
      const loadAndSetMessages = async () => {
        try {
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
            sendSystemMessageToDb(welcomeMessage.content);
            return;
          }

          if (data && data.length > 0) {
            // Messages exist, replace the temporary welcome with real messages
            setMessages(data);
            hasLoadedMessages.current = true;
          } else {
            // No messages exist, persist the welcome message to database in background
            sendSystemMessageToDb(welcomeMessage.content);
            hasLoadedMessages.current = true;
          }
        } catch (error: any) {
          console.error('Chat load error:', error);
          // Keep the welcome message visible even on error
          sendSystemMessageToDb(welcomeMessage.content);
        }
      };
      
      loadAndSetMessages();
    }
    
    return () => {
      isActive = false;
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

      // Call AI API (placeholder - implement with actual OpenAI integration)
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          message: currentInput,
          history: messages.slice(-10), // Last 10 messages for context
        }),
      });

      if (!response.ok) throw new Error("Failed to get AI response");

      const { message: aiResponse } = await response.json();

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

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl mx-auto w-full">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                message.role === "user"
                  ? "bg-[#f4f4f4] text-gray-900"
                  : "bg-white border border-gray-200"
              }`}
            >
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl px-5 py-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
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

