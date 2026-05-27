export const MAX_PLAN_PDF_BYTES = 150 * 1024 * 1024;
export const MAX_PLAN_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type PlanUploadRoute = "pdf_pipeline" | "attachment_api";

export interface PlanUploadValidation {
  ok: boolean;
  error?: string;
  route?: PlanUploadRoute;
}

function isPdf(file: File): boolean {
  const lower = file.name.toLowerCase();
  return file.type === "application/pdf" || lower.endsWith(".pdf");
}

function isLegacyAttachment(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(lower)) {
    return true;
  }
  if (
    file.type.includes("csv") ||
    file.type.includes("spreadsheet") ||
    lower.endsWith(".csv")
  ) {
    return true;
  }
  if (
    file.type.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  ) {
    return true;
  }
  return false;
}

export function validatePlanUpload(file: File): PlanUploadValidation {
  if (isPdf(file)) {
    if (file.size > MAX_PLAN_PDF_BYTES) {
      return {
        ok: false,
        error: `${file.name} exceeds the 150MB PDF limit. Try compressing the file or splitting it.`,
      };
    }
    if (file.size === 0) {
      return { ok: false, error: `${file.name} is empty.` };
    }
    return { ok: true, route: "pdf_pipeline" };
  }

  if (isLegacyAttachment(file)) {
    if (file.size > MAX_PLAN_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: `${file.name} exceeds the 20MB limit for images and spreadsheets.`,
      };
    }
    if (file.size === 0) {
      return { ok: false, error: `${file.name} is empty.` };
    }
    return { ok: true, route: "attachment_api" };
  }

  return {
    ok: false,
    error: `${file.name} is not supported. Upload PDF, image (PNG/JPG), CSV, or text files.`,
  };
}

export function buildPlanPdfStoragePath(projectId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  const uniqueId = crypto.randomUUID();
  return `project-${projectId}/plan-docs/${uniqueId}-${safeName}`;
}

export function isValidPlanPdfStoragePath(
  projectId: string,
  storagePath: string,
): boolean {
  const prefix = `project-${projectId}/plan-docs/`;
  return storagePath.startsWith(prefix) && storagePath.length > prefix.length;
}
