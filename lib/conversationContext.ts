// Conversation context tracking for better AI memory and state management

import { ChatMessage } from "@/types/database";

export interface ConversationContext {
  projectId: string;
  hasScope: boolean;
  mentionedProducts: string[];
  discussedTopics: string[];
  pendingQuestions: string[];
  lastQuoteGenerated?: {
    messageId: string;
    timestamp: string;
    total: number;
  };
  userPreferences: {
    brands?: string[];
    qualityLevel?: string;
    budgetRange?: string;
  };
}

/**
 * Analyzes conversation history to build context
 */
export function buildConversationContext(
  messages: ChatMessage[],
  projectId: string
): ConversationContext {
  const context: ConversationContext = {
    projectId,
    hasScope: false,
    mentionedProducts: [],
    discussedTopics: [],
    pendingQuestions: [],
    userPreferences: {},
  };

  // Analyze messages
  messages.forEach((msg, index) => {
    const content = msg.content.toLowerCase();

    // Check for scope of work
    if (msg.role === "user" && content.length > 50 && index < 3) {
      context.hasScope = true;
    }

    // Extract mentioned products (simple pattern matching)
    const productMatches = msg.content.match(/\b([A-Z][a-z]+\s*){1,3}(?:camera|cable|switch|panel|sensor|system|equipment)\b/gi);
    if (productMatches) {
      context.mentionedProducts.push(...productMatches);
    }

    // Extract brand preferences
    const brandMatches = msg.content.match(/\b(Hikvision|Axis|Samsung|Bosch|Ubiquiti|Cisco|etc)\b/gi);
    if (brandMatches && msg.role === "user") {
      context.userPreferences.brands = context.userPreferences.brands || [];
      context.userPreferences.brands.push(...brandMatches);
    }

    // Detect questions from AI
    if (msg.role === "assistant" && msg.content.includes("?")) {
      const questions = msg.content.split(/[.!]\s+/).filter(s => s.includes("?"));
      context.pendingQuestions.push(...questions.slice(-2)); // Keep last 2 questions
    }

    // Detect quote generation
    if (msg.role === "assistant" && msg.content.includes("QUOTE GENERATED")) {
      const totalMatch = msg.content.match(/Total:\s*\$?([\d,]+\.?\d*)/i);
      if (totalMatch) {
        context.lastQuoteGenerated = {
          messageId: msg.id,
          timestamp: msg.created_at,
          total: parseFloat(totalMatch[1].replace(/,/g, "")),
        };
      }
    }

    // Extract discussed topics
    if (content.includes("installation")) context.discussedTopics.push("installation");
    if (content.includes("budget")) context.discussedTopics.push("budget");
    if (content.includes("timeline")) context.discussedTopics.push("timeline");
    if (content.includes("warranty")) context.discussedTopics.push("warranty");
    if (content.includes("maintenance")) context.discussedTopics.push("maintenance");
  });

  // Deduplicate arrays
  context.mentionedProducts = [...new Set(context.mentionedProducts)].slice(0, 10);
  context.discussedTopics = [...new Set(context.discussedTopics)];
  if (context.userPreferences.brands) {
    context.userPreferences.brands = [...new Set(context.userPreferences.brands)];
  }

  return context;
}

/**
 * Generate a summary of conversation context for the AI
 */
export function generateContextSummary(context: ConversationContext): string {
  const parts: string[] = [];

  if (context.hasScope) {
    parts.push("✓ Scope of work has been provided");
  }

  if (context.mentionedProducts.length > 0) {
    parts.push(
      `Products discussed: ${context.mentionedProducts.slice(0, 5).join(", ")}`
    );
  }

  if (context.discussedTopics.length > 0) {
    parts.push(`Topics covered: ${context.discussedTopics.join(", ")}`);
  }

  if (context.userPreferences.brands && context.userPreferences.brands.length > 0) {
    parts.push(`Preferred brands: ${context.userPreferences.brands.join(", ")}`);
  }

  if (context.lastQuoteGenerated) {
    parts.push(
      `Last quote generated: $${context.lastQuoteGenerated.total.toFixed(2)} at ${new Date(
        context.lastQuoteGenerated.timestamp
      ).toLocaleTimeString()}`
    );
  }

  if (context.pendingQuestions.length > 0) {
    parts.push(`Pending questions: ${context.pendingQuestions.length}`);
  }

  return parts.length > 0 ? parts.join("\n") : "New conversation";
}

/**
 * Determine next best action based on conversation context
 */
export function suggestNextAction(context: ConversationContext): string {
  if (!context.hasScope) {
    return "ask_for_scope";
  }

  if (context.mentionedProducts.length === 0) {
    return "clarify_requirements";
  }

  if (context.pendingQuestions.length > 0) {
    return "await_response";
  }

  if (!context.lastQuoteGenerated) {
    return "prepare_quote";
  }

  return "refine_quote";
}

/**
 * Provide intelligent suggestions to the AI based on conversation state
 */
export function getConversationInsights(context: ConversationContext): string[] {
  const insights: string[] = [];

  if (context.mentionedProducts.length > 5) {
    insights.push("User has mentioned multiple products - ensure all are captured in the quote");
  }

  if (context.discussedTopics.includes("budget") && !context.lastQuoteGenerated) {
    insights.push("Budget was discussed - consider generating quote to show pricing");
  }

  if (context.lastQuoteGenerated && context.mentionedProducts.length > 0) {
    insights.push("Quote generated - user may want to refine or modify it");
  }

  if (context.userPreferences.brands && context.userPreferences.brands.length > 0) {
    insights.push(`User prefers: ${context.userPreferences.brands.join(", ")}`);
  }

  return insights;
}

/**
 * Format conversation metrics for display
 */
export function formatConversationMetrics(messages: ChatMessage[]): {
  messageCount: number;
  userMessages: number;
  aiMessages: number;
  conversationLength: string;
  lastActivity: string;
} {
  const userMessages = messages.filter((m) => m.role === "user").length;
  const aiMessages = messages.filter((m) => m.role === "assistant").length;

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];

  let conversationLength = "Just started";
  if (firstMessage && lastMessage) {
    const start = new Date(firstMessage.created_at);
    const end = new Date(lastMessage.created_at);
    const diffMinutes = Math.floor((end.getTime() - start.getTime()) / 1000 / 60);

    if (diffMinutes < 1) {
      conversationLength = "Just started";
    } else if (diffMinutes < 60) {
      conversationLength = `${diffMinutes} minutes`;
    } else {
      const hours = Math.floor(diffMinutes / 60);
      conversationLength = `${hours} hour${hours > 1 ? "s" : ""}`;
    }
  }

  const lastActivity = lastMessage
    ? new Date(lastMessage.created_at).toLocaleString()
    : "No activity yet";

  return {
    messageCount: messages.length,
    userMessages,
    aiMessages,
    conversationLength,
    lastActivity,
  };
}


