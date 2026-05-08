/**
 * PandaDoc Server-Side Client
 *
 * SECURITY: This file must ONLY be imported by server-side code (API routes,
 * Server Actions, or server components). Never import this from a client component.
 *
 * The API key is read exclusively from process.env and is never logged or
 * returned to the browser.
 */

// ---------------------------------------------------------------------------
// Environment helpers (evaluated lazily so Next.js build does not fail when
// the env var is absent in CI/build steps)
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.PANDADOC_API_KEY;
  if (!key) {
    throw new Error(
      "PANDADOC_API_KEY is not set. " +
        "Add it to .env.local for local development, or to your Vercel " +
        "environment variables for production."
    );
  }
  return key;
}

function getBaseUrl(): string {
  return (
    process.env.PANDADOC_API_BASE_URL ?? "https://api.pandadoc.com/public/v1"
  );
}

export function getPandaDocEnv(): "sandbox" | "production" {
  return process.env.PANDADOC_ENV === "production" ? "production" : "sandbox";
}

// ---------------------------------------------------------------------------
// Typed error class
// ---------------------------------------------------------------------------

export class PandaDocApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "PandaDocApiError";
  }
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface PandaDocRequestOptions {
  method?: HttpMethod;
  body?: unknown;
}

interface PandaDocErrorBody {
  type?: string;
  detail?: string;
  [key: string]: unknown;
}

async function pandaDocRequest<T>(
  path: string,
  { method = "GET", body }: PandaDocRequestOptions = {}
): Promise<T> {
  const apiKey = getApiKey();
  const url = `${getBaseUrl()}${path}`;

  const headers: Record<string, string> = {
    Authorization: `API-Key ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (networkError) {
    throw new PandaDocApiError(
      `PandaDoc network error: ${(networkError as Error).message}`,
      0
    );
  }

  if (!response.ok) {
    let errorCode: string | undefined;
    let errorDetail = response.statusText;

    try {
      const errorBody = (await response.json()) as PandaDocErrorBody;
      errorCode = errorBody.type;
      errorDetail = errorBody.detail ?? errorDetail;
    } catch {
      // Non-JSON error body — keep statusText
    }

    throw new PandaDocApiError(
      `PandaDoc API error ${response.status}: ${errorDetail}`,
      response.status,
      errorCode
    );
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Document status mapping
// ---------------------------------------------------------------------------

export type DocumentStatus =
  | "Draft"
  | "Sent"
  | "Viewed"
  | "Completed"
  | "Rejected"
  | "Expired"
  | "Unknown";

const STATUS_MAP: Record<string, DocumentStatus> = {
  "document.draft": "Draft",
  "document.sent": "Sent",
  "document.viewed": "Viewed",
  "document.completed": "Completed",
  "document.rejected": "Rejected",
  "document.expired": "Expired",
};

export function mapDocumentStatus(rawStatus: string): DocumentStatus {
  return STATUS_MAP[rawStatus] ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface PandaDocRecipient {
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
}

export interface PandaDocDocument {
  id: string;
  name: string;
  status: string;
  date_created: string;
  date_modified: string;
  expiration_date?: string;
  version?: string;
}

export interface DocumentStatusResult {
  id: string;
  status: DocumentStatus;
  rawStatus: string;
}

export interface CreateDocumentParams {
  name: string;
  recipients: PandaDocRecipient[];
  content?: Record<string, unknown>[];
  fields?: Record<string, unknown>;
  metadata?: Record<string, string>;
  tags?: string[];
}

export interface SendDocumentParams {
  message?: string;
  subject?: string;
  silent?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify the configured API key by calling the lightweight /members/me endpoint.
 * Returns true on success; throws PandaDocApiError on failure.
 */
export async function verifyConnection(): Promise<boolean> {
  await pandaDocRequest("/members/me");
  return true;
}

/**
 * Create a new PandaDoc document.
 * Placeholder — full implementation follows Proposal Builder integration.
 */
export async function createDocument(
  params: CreateDocumentParams
): Promise<PandaDocDocument> {
  return pandaDocRequest<PandaDocDocument>("/documents", {
    method: "POST",
    body: params,
  });
}

/**
 * Send a previously created document to its recipients.
 * Placeholder — full implementation follows Proposal Builder integration.
 */
export async function sendDocument(
  documentId: string,
  params: SendDocumentParams = {}
): Promise<void> {
  await pandaDocRequest(`/documents/${documentId}/send`, {
    method: "POST",
    body: params,
  });
}

/**
 * Fetch the current status of a document and return a normalised status string.
 * Placeholder — full implementation follows Proposal Builder integration.
 */
export async function getDocumentStatus(
  documentId: string
): Promise<DocumentStatusResult> {
  const doc = await pandaDocRequest<PandaDocDocument>(
    `/documents/${documentId}`
  );
  return {
    id: doc.id,
    rawStatus: doc.status,
    status: mapDocumentStatus(doc.status),
  };
}
