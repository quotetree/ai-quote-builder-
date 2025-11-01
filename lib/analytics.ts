// Internal Analytics & Event Tracking using Supabase

import { createClient } from "@/lib/supabase/client";

export type AnalyticsEventType =
  | "user_signup"
  | "user_login"
  | "project_created"
  | "project_opened"
  | "quote_generated"
  | "quote_committed"
  | "quote_downloaded"
  | "quote_status_changed"
  | "product_created"
  | "product_updated"
  | "product_deleted"
  | "csv_uploaded"
  | "document_uploaded"
  | "ai_chat_message"
  | "page_view"
  | "session_start"
  | "session_end";

interface TrackEventParams {
  eventType: AnalyticsEventType;
  eventData?: Record<string, any>;
  userId?: string;
}

class Analytics {
  private sessionId: string;
  private supabase: ReturnType<typeof createClient>;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.supabase = createClient();
    
    // Track session start
    if (typeof window !== "undefined") {
      this.trackEvent({ eventType: "session_start" });
      
      // Track session end on page unload
      window.addEventListener("beforeunload", () => {
        this.trackEvent({ eventType: "session_end" });
      });
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async trackEvent({ eventType, eventData = {}, userId }: TrackEventParams) {
    try {
      // Get current user if not provided
      if (!userId) {
        const { data: { user } } = await this.supabase.auth.getUser();
        userId = user?.id;
      }

      const event = {
        user_id: userId || null,
        event_type: eventType,
        event_data: {
          ...eventData,
          timestamp: new Date().toISOString(),
          user_agent: typeof window !== "undefined" ? window.navigator.userAgent : null,
          url: typeof window !== "undefined" ? window.location.href : null,
        },
        session_id: this.sessionId,
      };

      const { error } = await this.supabase
        .from("analytics_events")
        .insert(event);

      if (error) {
        console.error("Analytics tracking error:", error);
      }
    } catch (error) {
      console.error("Failed to track event:", error);
    }
  }

  trackPageView(pageName: string, additionalData?: Record<string, any>) {
    return this.trackEvent({
      eventType: "page_view",
      eventData: {
        page_name: pageName,
        ...additionalData,
      },
    });
  }

  trackProjectCreated(projectId: string, projectName: string) {
    return this.trackEvent({
      eventType: "project_created",
      eventData: {
        project_id: projectId,
        project_name: projectName,
      },
    });
  }

  trackQuoteGenerated(quoteId: string, projectId: string, itemCount: number) {
    return this.trackEvent({
      eventType: "quote_generated",
      eventData: {
        quote_id: quoteId,
        project_id: projectId,
        item_count: itemCount,
      },
    });
  }

  trackQuoteCommitted(quoteId: string, totalPrice: number) {
    return this.trackEvent({
      eventType: "quote_committed",
      eventData: {
        quote_id: quoteId,
        total_price: totalPrice,
      },
    });
  }

  trackProductCreated(productId: string, productName: string) {
    return this.trackEvent({
      eventType: "product_created",
      eventData: {
        product_id: productId,
        product_name: productName,
      },
    });
  }

  trackCsvUpload(rowCount: number, successCount: number) {
    return this.trackEvent({
      eventType: "csv_uploaded",
      eventData: {
        row_count: rowCount,
        success_count: successCount,
      },
    });
  }

  trackAIChatMessage(projectId: string, messageLength: number) {
    return this.trackEvent({
      eventType: "ai_chat_message",
      eventData: {
        project_id: projectId,
        message_length: messageLength,
      },
    });
  }
}

// Singleton instance
export const analytics = new Analytics();

// Convenience functions
export const trackEvent = (params: TrackEventParams) => analytics.trackEvent(params);
export const trackPageView = (pageName: string, data?: Record<string, any>) => 
  analytics.trackPageView(pageName, data);
export const trackProjectCreated = (projectId: string, projectName: string) => 
  analytics.trackProjectCreated(projectId, projectName);
export const trackQuoteGenerated = (quoteId: string, projectId: string, itemCount: number) => 
  analytics.trackQuoteGenerated(quoteId, projectId, itemCount);
export const trackQuoteCommitted = (quoteId: string, totalPrice: number) => 
  analytics.trackQuoteCommitted(quoteId, totalPrice);
export const trackProductCreated = (productId: string, productName: string) => 
  analytics.trackProductCreated(productId, productName);
export const trackCsvUpload = (rowCount: number, successCount: number) => 
  analytics.trackCsvUpload(rowCount, successCount);
export const trackAIChatMessage = (projectId: string, messageLength: number) => 
  analytics.trackAIChatMessage(projectId, messageLength);

