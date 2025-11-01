// Database types for QuoteTree.ai

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  company_address: string | null;
  role: 'user' | 'admin' | 'owner';
  license_type: 'trial' | 'basic' | 'pro' | 'enterprise';
  license_seats: number;
  created_at: string;
  updated_at: string;
}

export interface ProductFamily {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  user_id: string;
  product_number: string | null;
  product_name: string;
  product_family_id: string | null;
  product_type: string | null;
  product_tags: string[] | null;
  description: string | null;
  list_price: number;
  sales_price: number;
  cost_price: number | null;
  unit: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  project_name: string;
  product_families: string[] | null;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  project_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ProjectDocument {
  id: string;
  project_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  project_id: string;
  user_id: string;
  quote_number: string;
  quote_name: string;
  version_number: number;
  status: 'draft' | 'for_approval' | 'approved' | 'declined';
  scope_of_work: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount_rate: number;
  discount_amount: number;
  total_price: number;
  profit_margin: number;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
  items?: QuoteItem[];
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  product_id: string | null;
  product_number: string | null;
  product_name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  line_total: number;
  sort_order: number;
  created_at: string;
}

export interface AnalyticsEvent {
  id: string;
  user_id: string | null;
  event_type: string;
  event_data: Record<string, any>;
  session_id: string | null;
  created_at: string;
}

// Form types
export interface CreateProjectForm {
  project_name: string;
  product_families: string[];
}

export interface CreateProductForm {
  product_number?: string;
  product_name: string;
  product_family_id?: string;
  product_type?: string;
  product_tags?: string[];
  description?: string;
  list_price: number;
  sales_price: number;
  cost_price?: number;
  unit: string;
}

export interface CreateQuoteForm {
  project_id: string;
  quote_name: string;
  scope_of_work?: string;
}

// AI types
export interface AIQuoteRequest {
  projectId: string;
  scopeOfWork: string;
  productFamilies: string[];
  additionalContext?: string;
}

export interface AIQuoteResponse {
  items: {
    product_name: string;
    description: string;
    quantity: number;
    unit_price: number;
  }[];
  subtotal: number;
  tax_rate: number;
  recommendations: string[];
}

