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
  product_brand: string | null;
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

export interface ProductSuggestion {
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  selected?: boolean;
  id?: string;
  quantity_unit?: string | null;
  price_unit?: string | null;
  discount_percent?: number; // Percentage as decimal (0.10 = 10%)
  bakedAdjustments?: BakedAdjustment; // Baked markup adjustments applied to this item
  canonicalKey?: string; // Used for deduplication when pooling products
  stableKey?: string; // Deterministic key for cross-version mapping (hash of name+price+id)
  poolId?: string | null;
}

export interface ChargeConfig {
  id: string;
  name: string;
  rate: number; // Decimal (0.095 = 9.5%)
  applies_to: 'all' | 'exclude_products';
  excluded_products?: string[]; // Product names to exclude
  calculated_amount?: number;
  applies_to_count?: number;
  applies_to_total?: number;
}

export interface BakedMarkupSelector {
  include: 'all' | string[]; // 'all' or array of selectors like ["tag:brand", "item:id", "category:name"]
  exclude?: string[];
}

export interface BakedMarkupTarget {
  item_id?: string;
  itemId?: string;
  stable_key: string;
  amountCents?: number;
}

export interface BakedMarkupConfig {
  id: string;
  label: string;
  percent: number; // Decimal (0.075 = 7.5%)
  baseSelector: BakedMarkupSelector;
  addToSelector: BakedMarkupSelector;
  distribution: 'proportional' | 'even' | { singleItemId: string };
  rounding: {
    mode: 'bankers' | 'up' | 'down';
    places: number;
  };
  targets?: BakedMarkupTarget[]; // Exact items targeted at submit time (per-item allocations)
  audited: {
    base: number;
    totalMarkup: number;
    perItemDeltas: Record<string, number>; // stableKey -> delta amount
    perItemBaseBefore?: Record<string, number>; // stableKey -> price before this markup (for exact rollback)
  };
  createdAt: string;
  createdBy: string;
  supersededById?: string;
}

export interface BakedAdjustment {
  markupTotal?: number;
  breakdown?: Array<{ markupId: string; delta: number }>;
}

export interface QuotePreview {
  line_items: ProductSuggestion[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount_amount: number;
  total_price: number;
  charges?: ChargeConfig[];
  bakedMarkups?: BakedMarkupConfig[]; // Markup rules that bake amounts into item prices
}

export interface ProjectWorkingState {
  id: string;
  project_id: string;
  suggested_products: ProductSuggestion[];
  quote_preview: QuotePreview | null;
  show_split_view: boolean;
  created_at: string;
  updated_at: string;
  // Edit session fields
  current_edit_session_id: string | null;
  current_quote_id: string | null;
  edit_mode: boolean;
  current_pool_id: string | null;
  edit_started_at: string | null;
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
  charges?: ChargeConfig[]; // Tax/fee configurations
  bakedMarkups?: BakedMarkupConfig[]; // Baked markup rules
  // Edit session fields
  parent_quote_id: string | null;
  edit_session_id: string | null;
  change_notes: string | null;
  diff_summary: QuoteDiffSummary | null;
  author_id: string | null;
  is_editing: boolean;
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
  product_brand?: string;
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

// Edit session types
export interface QuoteEditSession {
  id: string;
  quote_id: string;
  project_id: string;
  user_id: string;
  version_being_edited: number;
  snapshot: QuoteSnapshot;
  started_at: string;
  last_activity_at: string;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
}

export interface QuoteSnapshot {
  quote: Quote;
  items: QuoteItem[];
  charges?: ChargeConfig[];
  bakedMarkups?: BakedMarkupConfig[];
}

export interface QuoteDiffSummary {
  items_added?: QuoteItemDiff[];
  items_removed?: QuoteItemDiff[];
  items_modified?: QuoteItemDiff[];
  charges_changed?: boolean;
  subtotal_delta?: number;
  total_delta?: number;
}

export interface QuoteItemDiff {
  product_name: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
  old_quantity?: number;
  old_unit_price?: number;
  old_line_total?: number;
}

export interface QuoteVersionHistory {
  id: string;
  quote_id: string;
  version_number: number;
  changed_by: string | null;
  change_type: 'created' | 'edited' | 'approved' | 'declined' | 'status_changed';
  change_notes: string | null;
  diff_summary: QuoteDiffSummary;
  snapshot: Record<string, any>;
  created_at: string;
}

// AI types
export interface AIQuoteRequest {
  projectId: string;
  scopeOfWork: string;
  productFamilies: string[];
  additionalContext?: string;
  editSessionId?: string;
  editContext?: QuoteEditContext;
}

export interface QuoteEditContext {
  quoteId: string;
  sessionId: string;
  currentSnapshot: QuoteSnapshot;
  editInstruction: string;
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

