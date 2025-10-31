// Type definitions for QuoteTree.ai

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  company_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  order: number;
}

export interface Quote {
  id: string;
  user_id: string;
  client_id: string | null;
  project_name: string;
  description: string | null;
  status: "draft" | "sent" | "accepted" | "rejected";
  subtotal: number;
  tax: number;
  total: number;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  items?: QuoteItem[];
}

export interface AIQuoteRequest {
  projectName: string;
  clientName: string;
  description: string;
  additionalContext?: string;
}

export interface AIQuoteResponse {
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
  }[];
  estimatedTotal: number;
  suggestions: string[];
}

