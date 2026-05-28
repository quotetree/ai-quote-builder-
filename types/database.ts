// Database types for QuoteTree.ai

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  company_address: string | null;
  organization_id: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// WORKSPACE & ORGANIZATION TYPES
// ============================================

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export type MemberRole = 'owner' | 'super_admin' | 'admin';

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export type PlanType = 'free' | 'individual' | 'organization';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';

export interface Subscription {
  id: string;
  organization_id: string;
  plan_type: PlanType;
  billing_cycle: BillingCycle | null;
  status: SubscriptionStatus;
  trial_start_date: string | null;
  trial_end_date: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  base_licenses: number;
  additional_licenses: number;
  total_licenses: number; // computed field
  base_price_cents: number;
  additional_license_price_cents: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  pending_plan_change: {
    plan_type: PlanType;
    billing_cycle: BillingCycle;
    additional_licenses: number;
    scheduled_for: string; // ISO date when change will occur
    created_at: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: Exclude<MemberRole, 'owner'>; // Can't invite as owner
  invited_by: string;
  invitation_token: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// Helper type for user's organization context
export interface UserOrganizationContext {
  organization_id: string;
  organization_name: string;
  role: MemberRole;
  plan_type: PlanType;
  subscription_status: SubscriptionStatus;
  total_licenses: number;
  used_licenses: number;
  available_licenses: number;
  trial_end_date: string | null;
}

// Proration preview for plan changes
export interface ProrationPreview {
  prorationAmount: number; // in cents (positive for charge, 0 for downgrades)
  isUpgrade: boolean;
  requiresCheckout: boolean; // true if needs to go through Stripe Checkout
  scheduledForPeriodEnd?: boolean; // true for downgrades (takes effect at period end)
  resetsBillingAnchor?: boolean; // true if billing anchor resets to today
  effectiveDate: string;
  currentPlanDescription: string;
  newPlanDescription: string;
  currentPeriodEnd?: string | null;
  billingMessage?: string; // Custom message explaining the charge/change
}

// Member with user profile information
export interface OrganizationMemberWithProfile extends OrganizationMembership {
  profile: {
    email: string;
    full_name: string | null;
    company_name: string | null;
  };
}

// Plan pricing constants
export const PLAN_PRICING = {
  individual: {
    monthly: 7900, // $79.00 in cents
    yearly: 6500, // $65.00 in cents (per month, billed yearly)
  },
  organization: {
    monthly: {
      base: 15800, // $158.00 in cents (2 licenses included)
      perAdditionalLicense: 7900, // $79.00 in cents
    },
    yearly: {
      base: 13000, // $130.00 in cents (per month, billed yearly - 2 licenses included)
      perAdditionalLicense: 6500, // $65.00 in cents (per month, billed yearly)
    },
    baseLicenses: 2, // Changed from 3 to 2
  },
} as const;

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
  share_token?: string | null;
  share_token_created_at?: string | null;
}

export interface ChatMessage {
  id: string;
  project_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ChatAttachment {
  id: string;
  project_id: string;
  uploaded_by: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  extracted_text: string | null;
  vision_summary: string | null;
  parse_status: 'pending' | 'processing' | 'ready' | 'error';
  parse_error: string | null;
  source: 'plan_upload' | 'drive_reference';
  project_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanChatSource {
  title: string;
  url: string;
}

export interface PlanDocumentCitation {
  fileName: string;
  pageStart: number;
  pageEnd: number;
}

export interface ProductSuggestion {
  product_id?: string; // Product ID from price book
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
  product_brand?: string; // Product brand from price book
  product_type?: string; // Product type from price book
  match_confidence?: number; // Matching confidence score (for debugging)
  requested_item?: string; // What the user requested (for low-confidence matches)
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
  percent?: number; // Decimal (0.075 = 7.5%) - retained for backwards compatibility
  calculationMode?: 'percent' | 'amount';
  lumpSumAmount?: number; // Explicit lump sum amount (in dollars)
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
  folder_id?: string | null;
  mime_type?: string | null;
  upload_status?: 'uploading' | 'uploaded' | 'failed';
  processing_status?: 'pending' | 'processing' | 'ready' | 'failed';
  page_count?: number | null;
  processing_progress?: {
    phase?: "pages" | "ocr" | "chunks" | "extractions";
    pageCount?: number;
    pagesWritten?: number;
    ocrCompletedUpTo?: number;
    chunksInserted?: number;
    extractionsComplete?: boolean;
  } | null;
  doc_source?: 'drive' | 'plan_upload';
  extracted_text?: string | null;
  vision_summary?: string | null;
  search_text?: string | null;
  parse_status?: 'pending' | 'processing' | 'ready' | 'error' | 'skipped';
  parse_error?: string | null;
  indexed_at?: string | null;
  updated_at?: string | null;
  created_at: string;
}

export interface DocumentChunkMetadata {
  has_table?: boolean;
  contains_quantities?: boolean;
  contains_locations?: boolean;
  contains_materials?: boolean;
  contains_scope_language?: boolean;
  contains_labor_requirements?: boolean;
  contains_trade_terms?: boolean;
  metadata_version?: number;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  project_id: string;
  page_start: number;
  page_end: number;
  chunk_index: number;
  chunk_text: string;
  token_count: number | null;
  chunk_metadata?: DocumentChunkMetadata | null;
  created_at: string;
}

export interface DocumentPage {
  id: string;
  document_id: string;
  project_id: string;
  page_number: number;
  native_text: string | null;
  ocr_text: string | null;
  extraction_method: "native" | "ocr" | "hybrid" | "empty";
  ocr_confidence: number | null;
  created_at: string;
}

export type DocumentExtractionType =
  | "table"
  | "schedule"
  | "spec_section"
  | "quantity"
  | "entity";

export interface DocumentExtraction {
  id: string;
  document_id: string;
  project_id: string;
  extraction_type: DocumentExtractionType;
  page_start: number;
  page_end: number;
  title: string | null;
  discipline: string | null;
  payload: Record<string, unknown>;
  confidence: number | null;
  source_chunk_ids: string[] | null;
  extraction_version: number;
  created_at: string;
}

export interface ProjectFolder {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectNote {
  id: string;
  project_id: string;
  folder_id: string | null;
  title: string;
  content: {
    html?: string;
    text?: string;
  } | null;
  plain_text: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// ESTIMATE SPREADSHEET TYPES
// ============================================

export type SpreadsheetTemplateId = 'purchase_order' | 'invoice' | 'timesheet';

export interface SpreadsheetRow {
  id: string;
  /** Free-text label the user typed into the Product/Service column */
  custom_label: string;
  /** UUID of the matched price book product, null if unmatched */
  product_id: string | null;
  product_name: string;
  product_code: string;
  list_price: number;
  sales_price: number;
  /** Discount percentage as a whole number (e.g. 10 = 10%). 0 means no discount. */
  discount: number;
  quantity: number;
}

export interface SpreadsheetSection {
  id: string;
  /** Editable section header, e.g. "Product or service", "Labor", etc. */
  label: string;
  rows: SpreadsheetRow[];
}

export interface ProjectSpreadsheet {
  id: string;
  project_id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  template_id: SpreadsheetTemplateId | null;
  sections: SpreadsheetSection[];
  charges: ChargeConfig[];
  baked_markups: BakedMarkupConfig[];
  subtotal: number;
  total: number;
  created_at: string;
  updated_at: string;
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
  // Spreadsheet link (Phase 1+)
  spreadsheet_id: string | null;
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
  product?: Product | null;
  list_price?: number | null;
  cost_price?: number | null;
  unit_cost?: number | null;
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

export interface ProfitOverride {
  id: string;
  quote_id: string;
  item_id: string;
  override_list_price: number | null;
  override_sales_price: number | null;
  created_at: string;
  updated_at: string;
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

// ============================================
// STRIPE BILLING TYPES
// ============================================

export interface StripePaymentMethod {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

export interface StripeBillingInfo {
  name: string | null;
  email: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  } | null;
}

export interface StripeInvoice {
  id: string;
  number: string | null;
  created: number;
  amount_paid: number;
  currency: string;
  status: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}


// ============================================
// SPREADSHEET TEMPLATE TYPES
// ============================================

export interface SpreadsheetTemplate {
  id: string;
  user_id: string;
  title: string;
  sections: SpreadsheetSection[];
  charges: ChargeConfig[];
  baked_markups: BakedMarkupConfig[];
  created_at: string;
  updated_at: string;
}
