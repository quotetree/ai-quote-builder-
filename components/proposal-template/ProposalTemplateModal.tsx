"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, Download, ExternalLink, Eye, FileEdit, Link2, Plus, Save, Search, Users, X } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";
import { useProposalTemplate } from "@/hooks/useProposalTemplate";
import { ElementType, ProposalRecipient, ProposalSignatureStatus, TemplatePage, QUOTE_PLACEHOLDER_ID } from "./proposalTemplateTypes";
import ProposalPage, { PAGE_HEIGHT } from "./ProposalPage";
import ProposalEditorToolbar from "./ProposalEditorToolbar";
import ProposalCanvas from "./ProposalCanvas";
import ProposalQuickAdd, { QuoteOption } from "./ProposalQuickAdd";
import ProposalFieldManager from "./ProposalFieldManager";
import ProposalExportRenderer from "./ProposalExportRenderer";
import ProposalRecipientsPanel from "./ProposalRecipientsPanel";
import ProposalShareLinkModal from "./ProposalShareLinkModal";

type ActiveTab = "editor" | "view" | "recipients";

// ── Module-level pure async helpers (no hooks — safe to call anywhere) ────────

/**
 * Calls /api/quotes/pdf (real or mock), renders each PDF page to a PNG canvas
 * via pdf.js, and uploads to Supabase storage.  Returns the public URLs and
 * document heights so callers can build TemplatePage objects.
 */
async function uploadQuotePNGs(
  quoteId: string,
  organizationId: string,
  supabase: ReturnType<typeof createClient>,
  mock = false
): Promise<{ urls: string[]; heights: number[] }> {
  const res = await fetch("/api/quotes/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mock ? { mock: true } : { quoteId }),
  });
  if (!res.ok) throw new Error(`PDF generation failed: ${res.statusText}`);
  const pdfBlob = await res.blob();

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await pdfBlob.arrayBuffer() }).promise;
  const numPages = pdf.numPages;

  const urls: string[] = [];
  const heights: number[] = [];
  const stamp = Date.now();

  for (let p = 1; p <= numPages; p++) {
    const pdfPage = await pdf.getPage(p);
    const baseVp = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale: 816 / baseVp.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await pdfPage.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png")
    );
    const filePath = `${organizationId}/${stamp}-quote-${quoteId}-p${p}.png`;
    const { error: upErr } = await supabase.storage
      .from("proposal-assets")
      .upload(filePath, blob, { contentType: "image/png", upsert: true });
    if (upErr) throw upErr;
    urls.push(supabase.storage.from("proposal-assets").getPublicUrl(filePath).data.publicUrl);
    heights.push(1056);
  }

  return { urls, heights };
}

/**
 * Replaces every run of QUOTE_PLACEHOLDER_ID pages in `pages` with real quote
 * pages (built from the supplied PNG urls / heights / metadata).
 * Pure — does not touch React state.
 */
function replacePlaceholdersInPages(
  pages: TemplatePage[],
  urls: string[],
  heights: number[],
  quoteId: string,
  quoteName: string,
  quoteNumber: string
): TemplatePage[] {
  const result: TemplatePage[] = [];
  let i = 0;
  while (i < pages.length) {
    if (pages[i].quoteId === QUOTE_PLACEHOLDER_ID) {
      urls.forEach((url, j) => {
        result.push({
          id: crypto.randomUUID(),
          elements: [],
          backgroundImage: url,
          pageHeight: heights[j],
          quoteId,
          quoteName,
          quoteNumber,
        });
      });
      // Skip all consecutive placeholder pages (multi-page placeholder runs)
      while (i < pages.length && pages[i].quoteId === QUOTE_PLACEHOLDER_ID) i++;
    } else {
      result.push(pages[i]);
      i++;
    }
  }
  return result;
}

interface ProposalTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When true, renders inline (no fixed overlay) to fill its parent container. */
  inline?: boolean;
  /** When provided, load/save targets quote_proposals for this quote instead of proposal_templates. */
  quoteId?: string;
  /** Used as the PDF filename when downloading (no extension needed). */
  quoteName?: string;
  /** When provided, quotes from this project are loaded for the quote element picker. */
  projectId?: string;
}

export default function ProposalTemplateModal({ isOpen, onClose, inline, quoteId, quoteName, projectId }: ProposalTemplateModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const { organizationId } = useOrganizationRole();

  const [activeTab, setActiveTab] = useState<ActiveTab>("editor");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const DEFAULT_CUSTOM_VARIABLES = [
    "Client.Name",
    "Client.Company",
    "Client.Email",
    "Project.Title",
    "Project.Date",
  ];
  const [customVariables, setCustomVariables] = useState<string[]>(DEFAULT_CUSTOM_VARIABLES);
  // Whether the initial load from localStorage has happened yet (prevents
  // saving the default list back to storage before reading what's stored).
  const varsLoadedRef = useRef(false);
  const [quickAddAnchor, setQuickAddAnchor] = useState<{ x: number; y: number } | null>(null);
  const [commandStates, setCommandStates] = useState({
    bold: false, italic: false, underline: false,
    justifyLeft: false, justifyCenter: false, justifyRight: false,
    fontSize: 14,
  });

  // Saved selection state so font-size changes can be applied after the dropdown steals focus
  const savedRangeRef = useRef<Range | null>(null);
  const savedEditableRef = useRef<HTMLElement | null>(null);
  // Refs to the hidden off-screen page divs used for html2canvas PDF capture
  const hiddenPageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Tracks which element ids have content that exceeds their page height
  const [overflowedElementIds, setOverflowedElementIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [downloadingPDF, setDownloadingPDF] = useState(false);

  // E-signature recipients
  const [recipients, setRecipients] = useState<ProposalRecipient[]>([]);
  // Tracks whether recipients have been loaded from DB — skips auto-save on initial population
  const recipientsLoadedRef = useRef(false);
  // "idle" | "saving" | "saved"
  const [recipientsAutoSave, setRecipientsAutoSave] = useState<"idle" | "saving" | "saved">("idle");
  // Share-link modal
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  // Signature status (refreshed after links are generated or on load)
  const [signatureStatus, setSignatureStatus] = useState<ProposalSignatureStatus | null>(null);
  // Existing signer links loaded from DB (populated when a signing request has already been sent)
  const [existingSignerLinks, setExistingSignerLinks] = useState<Array<{
    email: string; name: string; firma_user_id: string; signing_url: string; signed_at?: string;
  }>>([]);
  // Completed signing: URLs stored by Firma webhook
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  const [auditTrailUrl, setAuditTrailUrl] = useState<string | null>(null);
  // Edit-document confirmation modal
  const [editDocumentModalOpen, setEditDocumentModalOpen] = useState(false);
  // Send / Actions dropdown open state
  const [sendDropdownOpen, setSendDropdownOpen] = useState(false);
  const sendDropdownRef = useRef<HTMLDivElement>(null);

  // Quote element: available quotes for the picker
  const [availableQuotes, setAvailableQuotes] = useState<QuoteOption[]>([]);
  // When set, shows a picker to change the quote on an existing element
  const [changeQuoteElementId, setChangeQuoteElementId] = useState<string | null>(null);
  const [changeQuoteSearch, setChangeQuoteSearch] = useState("");
  // When set, shows a picker to add a new quote page at this index
  const [addQuotePageAtIndex, setAddQuotePageAtIndex] = useState<number | null>(null);
  const [addQuotePageSearch, setAddQuotePageSearch] = useState("");
  // "Change quote page" — replaces an existing quote background-image page
  const [changeQuotePageIndex, setChangeQuotePageIndex] = useState<number | null>(null);
  const [changeQuotePageOldId, setChangeQuotePageOldId] = useState<string>("");
  const [changeQuotePageSearch, setChangeQuotePageSearch] = useState("");
  const {
    pages,
    activePageIndex,
    setActivePageIndex,
    selectedElementId,
    selectedElement,
    canUndo,
    canRedo,
    undo,
    redo,
    addElement,
    insertElementAfter,
    updateElementHeight,
    addTextToNextPage,
    insertPageAt,
    duplicatePage,
    deletePage,
    moveElement,
    commitMove,
    resizeElement,
    commitResize,
    updateElementStyles,
    updateElementContent,
    updateElementVariableName,
    syncCustomVarContentByName,
    duplicateElement,
    deleteElement,
    setSelectedElementId,
    resetPages,
    insertPagesWithBackground,
    insertQuotePages,
    replaceQuotePages,
  } = useProposalTemplate();

  // Derive overflow state for non-text elements from page state.
  // Text overflow is handled in real-time by handleHeightChange (using scrollHeight).
  // All other element types are checked here after each state change.
  useEffect(() => {
    const PAGE_FLOOR = PAGE_HEIGHT - 40;
    setOverflowedElementIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const page of pages) {
        for (const el of page.elements) {
          if (el.type === "text") continue; // text handled by handleHeightChange
          const atLimit = el.y + el.h >= PAGE_FLOOR;
          if (atLimit && !next.has(el.id)) { next.add(el.id); changed = true; }
          if (!atLimit && next.has(el.id)) { next.delete(el.id); changed = true; }
        }
      }
      return changed ? next : prev;
    });
  }, [pages]);

  const [uploading, setUploading] = useState(false);

  /**
   * Uploads one or more files (images or PDFs) and inserts them as proposal pages.
   * PDFs are converted page-by-page to PNG via pdf.js before uploading.
   */
  const handleUploadFile = async (atIndex: number, files: FileList) => {
    if (!organizationId) return;

    const ALLOWED_IMAGE = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

    setUploading(true);
    const toastId = toast.loading("Uploading…");

    try {
      // Collect all page background URLs across every chosen file
      const allUrls: string[] = [];
      const allPageHeights: number[] = [];
      const stamp = Date.now();

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];

        if (file.size > MAX_FILE_SIZE) {
          toast.error(`"${file.name}" exceeds the 50 MB limit.`, { id: toastId });
          setUploading(false);
          return;
        }

        if (file.type === "application/pdf") {
          // ── PDF → render each page to PNG via pdf.js ──
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

          const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
          const numPages = pdf.numPages;

          toast.loading(`Converting PDF (${numPages} page${numPages > 1 ? "s" : ""})…`, { id: toastId });

          for (let p = 1; p <= numPages; p++) {
            const pdfPage = await pdf.getPage(p);
            // Scale so the rendered width matches our canvas page width (816 px)
            const baseVp = pdfPage.getViewport({ scale: 1 });
            const viewport = pdfPage.getViewport({ scale: 816 / baseVp.width });

            const canvas = document.createElement("canvas");
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            await pdfPage.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;

            const blob = await new Promise<Blob>((res) =>
              canvas.toBlob((b) => res(b!), "image/png")
            );

            const filePath = `${organizationId}/${stamp}-f${fi}-p${p}.png`;
            const { error: upErr } = await supabase.storage
              .from("proposal-assets")
              .upload(filePath, blob, { contentType: "image/png", upsert: true });
            if (upErr) throw upErr;

            const pdfPageUrl = supabase.storage.from("proposal-assets").getPublicUrl(filePath).data.publicUrl;
            allUrls.push(pdfPageUrl);
            allPageHeights.push(1056); // PDF pages are always full height
          }
        } else if (ALLOWED_IMAGE.includes(file.type)) {
          // ── Image → measure dims from local File first (reliable), then upload ──

          // Measure natural dimensions from the local file — never fails due to CDN/CORS
          const localObjectUrl = URL.createObjectURL(file);
          const { natW, natH } = await new Promise<{ natW: number; natH: number }>((resolve) => {
            const img = new window.Image();
            img.onload = () => {
              resolve({ natW: img.naturalWidth, natH: img.naturalHeight });
              URL.revokeObjectURL(localObjectUrl);
            };
            img.onerror = () => {
              resolve({ natW: 816, natH: 1056 });
              URL.revokeObjectURL(localObjectUrl);
            };
            img.src = localObjectUrl;
          });

          // Upload to Supabase Storage
          const ext = file.name.split(".").pop() ?? "png";
          const filePath = `${organizationId}/${stamp}-f${fi}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("proposal-assets")
            .upload(filePath, file, { contentType: file.type, upsert: true });
          if (upErr) throw upErr;

          const publicUrl = supabase.storage
            .from("proposal-assets")
            .getPublicUrl(filePath).data.publicUrl;

          // Page height = exact scaled image height — no padding, edge-to-edge
          const PAGE_W = 816;
          const PAGE_H = 1056;
          const fittedH = Math.min(PAGE_H, Math.max(80, Math.round(PAGE_W * natH / Math.max(natW, 1))));

          allUrls.push(publicUrl);
          allPageHeights.push(fittedH);
        } else {
          toast.error(
            `Unsupported file type: "${file.name}". Use PDF, PNG, JPG, GIF, or WebP.`,
            { id: toastId }
          );
          setUploading(false);
          return;
        }
      }

      // Single call — inserts all pages at the target position, with heights
      insertPagesWithBackground(atIndex, allUrls, allPageHeights);
      toast.success(
        `Inserted ${allUrls.length} page${allUrls.length > 1 ? "s" : ""}.`,
        { id: toastId }
      );
    } catch (err: unknown) {
      console.error("Upload error:", err);
      toast.error(err instanceof Error ? err.message : "Upload failed.", { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  // Load template / proposal on open
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    let mounted = true;
    recipientsLoadedRef.current = false;

    const load = async () => {
      setInitializing(true);
      setTemplateId(null);
      try {
        if (quoteId) {
          // ── Quote-specific proposal ──
          const { data, error } = await supabase
            .from("quote_proposals")
            .select("id, pages, recipients")
            .eq("quote_id", quoteId)
            .maybeSingle();

          if (error && error.code !== "42P01") throw error;

          if (mounted && data) {
            setTemplateId(data.id);
            const parsed: TemplatePage[] = Array.isArray(data.pages) ? data.pages : [];

            // Populate recipients immediately so the Recipients tab is ready
            // before (and regardless of) any slow PNG-generation work below.
            const parsedRecipients: ProposalRecipient[] = Array.isArray(data.recipients)
              ? data.recipients
              : [];
            setRecipients(parsedRecipients);
            // Mark as loaded so the auto-save effect doesn't fire for this initial set
            recipientsLoadedRef.current = true;

            // If there are placeholder pages, await the real quote PNG generation
            // before releasing the loading state so the user never sees a flash
            // of the placeholder quote image.
            const hasPlaceholders = parsed.some((p) => p.quoteId === QUOTE_PLACEHOLDER_ID);
            if (hasPlaceholders && organizationId) {
              try {
                const { data: q } = await supabase
                  .from("quotes")
                  .select("quote_number, quote_name")
                  .eq("id", quoteId)
                  .single();
                if (q && mounted) {
                  const { urls, heights } = await uploadQuotePNGs(quoteId, organizationId, supabase);
                  if (mounted) {
                    resetPages(replacePlaceholdersInPages(parsed, urls, heights, quoteId, q.quote_name, q.quote_number));
                  }
                } else if (parsed.length > 0 && mounted) {
                  resetPages(parsed);
                }
              } catch (err) {
                console.warn("[load] Placeholder replacement failed:", err);
                if (parsed.length > 0 && mounted) resetPages(parsed);
              }
            } else if (parsed.length > 0) {
              resetPages(parsed);
            }

            // Load existing signature status, signer links, and completed-doc URLs
            const { data: sig } = await supabase
              .from("proposal_signatures")
              .select("status, all_signers_data, signed_pdf_url, audit_trail_url")
              .eq("proposal_id", data.id)
              .maybeSingle();
            if (mounted) {
              if (sig?.status) {
                setSignatureStatus(sig.status as ProposalSignatureStatus);
              } else {
                setSignatureStatus(null);
              }
              if (Array.isArray(sig?.all_signers_data)) {
                setExistingSignerLinks(sig!.all_signers_data as typeof existingSignerLinks);
              } else {
                setExistingSignerLinks([]);
              }
              setSignedPdfUrl((sig as Record<string, unknown> | null)?.signed_pdf_url as string ?? null);
              setAuditTrailUrl((sig as Record<string, unknown> | null)?.audit_trail_url as string ?? null);
            }
          } else if (mounted) {
            // No record yet — seed from org template so content is pre-populated
            const { data: orgTpl } = await supabase
              .from("proposal_templates")
              .select("pages")
              .eq("organization_id", organizationId)
              .maybeSingle();
            const seedPages: TemplatePage[] = Array.isArray(orgTpl?.pages) ? orgTpl!.pages : [];

            // Same flash-prevention as above: await PNG generation when the seed
            // template contains placeholder quote pages.
            const seedHasPlaceholders = seedPages.some((p) => p.quoteId === QUOTE_PLACEHOLDER_ID);
            if (seedHasPlaceholders && organizationId) {
              try {
                const { data: q } = await supabase
                  .from("quotes")
                  .select("quote_number, quote_name")
                  .eq("id", quoteId)
                  .single();
                if (q && mounted) {
                  const { urls, heights } = await uploadQuotePNGs(quoteId, organizationId, supabase);
                  if (mounted) {
                    resetPages(replacePlaceholdersInPages(seedPages, urls, heights, quoteId, q.quote_name, q.quote_number));
                  }
                } else if (seedPages.length > 0 && mounted) {
                  resetPages(seedPages);
                }
              } catch (err) {
                console.warn("[load] Placeholder replacement (seed) failed:", err);
                if (seedPages.length > 0 && mounted) resetPages(seedPages);
              }
            } else if (seedPages.length > 0) {
              resetPages(seedPages);
            }
            // templateId stays null; first Save will insert a new quote_proposals row
          }
        } else {
          // ── Org-level template (original path — unchanged) ──
          const { data, error } = await supabase
            .from("proposal_templates")
            .select("id, pages")
            .eq("organization_id", organizationId)
            .maybeSingle();

          // Ignore "table does not exist" errors (migration not yet applied)
          if (error && error.code !== "42P01") throw error;
          if (mounted && data) {
            setTemplateId(data.id);
            const parsed: TemplatePage[] = Array.isArray(data.pages) ? data.pages : [];
            if (parsed.length > 0) resetPages(parsed);
          }
        }
      } catch (err: any) {
        console.warn("Could not load proposal:", err?.message ?? err);
      } finally {
        if (mounted) setInitializing(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [isOpen, organizationId, quoteId, supabase, resetPages]);

  // Load available quotes for the quote element picker
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    let mounted = true;
    const fetchQuotes = async () => {
      try {
        let query = supabase
          .from("quotes")
          .select("id, quote_number, quote_name")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false });

        if (projectId) {
          query = supabase
            .from("quotes")
            .select("id, quote_number, quote_name")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false });
        }

        const { data } = await query;
        if (mounted && data) {
          setAvailableQuotes(
            data.map((q: any) => ({
              id: q.id,
              quote_number: q.quote_number ?? "",
              quote_name: q.quote_name ?? "",
            }))
          );
        }
      } catch {
        // non-fatal
      }
    };
    fetchQuotes();
    return () => { mounted = false; };
  }, [isOpen, organizationId, projectId, supabase]);

  // Keep toolbar button states + current font size in sync with cursor/selection
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      try {
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0) {
          // Save range so we can restore it after the font-size dropdown steals focus
          savedRangeRef.current = sel.getRangeAt(0).cloneRange();
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.contentEditable === "true") {
            savedEditableRef.current = focused;
          }

          // Detect the computed font size at the cursor anchor
          const anchorNode = sel.anchorNode;
          const el =
            anchorNode?.nodeType === Node.TEXT_NODE
              ? (anchorNode as Text).parentElement
              : (anchorNode as HTMLElement | null);
          const rawSize = el ? parseFloat(window.getComputedStyle(el).fontSize) : NaN;
          const detectedSize = !isNaN(rawSize) ? Math.round(rawSize) : null;

          setCommandStates({
            bold: document.queryCommandState("bold"),
            italic: document.queryCommandState("italic"),
            underline: document.queryCommandState("underline"),
            justifyLeft: document.queryCommandState("justifyLeft"),
            justifyCenter: document.queryCommandState("justifyCenter"),
            justifyRight: document.queryCommandState("justifyRight"),
            fontSize: detectedSize ?? selectedElement?.styles.fontSize ?? 14,
          });
        }
      } catch {
        // queryCommandState can throw in some browsers — ignore
      }
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [isOpen, selectedElement]);

  // ── Custom variable persistence via localStorage ───────────────────────────
  // Load saved variables once organizationId is available.
  // Falls back to DEFAULT_CUSTOM_VARIABLES if nothing is stored yet.
  useEffect(() => {
    if (!organizationId) return;
    try {
      const stored = localStorage.getItem(`proposal_vars_${organizationId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCustomVariables(parsed);
        }
      }
    } catch {
      // ignore parse errors — defaults stay
    }
    varsLoadedRef.current = true;
  }, [organizationId]);

  // Persist whenever the list changes (after initial load so we don't overwrite storage with defaults).
  useEffect(() => {
    if (!organizationId || !varsLoadedRef.current) return;
    try {
      localStorage.setItem(`proposal_vars_${organizationId}`, JSON.stringify(customVariables));
    } catch {
      // storage quota exceeded — ignore
    }
  }, [customVariables, organizationId]);

  // Auto-save recipients to DB whenever they change (debounced 800 ms)
  useEffect(() => {
    if (!quoteId || !organizationId) return;

    // Skip the very first population from the DB load
    if (!recipientsLoadedRef.current) return;

    setRecipientsAutoSave("saving");

    const timer = setTimeout(async () => {
      try {
        if (templateId) {
          const { error } = await supabase
            .from("quote_proposals")
            .update({ recipients, updated_at: new Date().toISOString() })
            .eq("id", templateId);
          if (error) throw error;
        } else {
          // Proposal row doesn't exist yet — create it with current pages + recipients
          const { data, error } = await supabase
            .from("quote_proposals")
            .insert({ quote_id: quoteId, organization_id: organizationId, pages, recipients })
            .select("id")
            .single();
          if (error) throw error;
          if (data) setTemplateId(data.id);
        }
        setRecipientsAutoSave("saved");
        // Clear the "Saved" indicator after 2 s
        setTimeout(() => setRecipientsAutoSave("idle"), 2000);
      } catch (err) {
        console.error("[auto-save recipients] Failed:", err);
        setRecipientsAutoSave("idle");
      }
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients]);

  // Close send dropdown on outside click
  useEffect(() => {
    if (!sendDropdownOpen) return;
    const handle = (e: MouseEvent) => {
      if (sendDropdownRef.current && !sendDropdownRef.current.contains(e.target as Node)) {
        setSendDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [sendDropdownOpen]);

  /**
   * Calls /api/firma/sync-status which polls the Firma API directly,
   * updates Supabase if anything changed, and returns the latest state.
   *
   * This is the primary refresh path — it works regardless of whether
   * webhooks are configured or reachable (local dev, wrong secret, etc.).
   */
  const refreshSignatureStatus = useCallback(async () => {
    if (!quoteId) return;
    try {
      const res = await fetch("/api/firma/sync-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status) {
        setSignatureStatus(data.status as ProposalSignatureStatus);
      }
      if (Array.isArray(data.all_signers_data) && data.all_signers_data.length > 0) {
        setExistingSignerLinks(data.all_signers_data as typeof existingSignerLinks);
      }
      if (data.signed_pdf_url !== undefined) setSignedPdfUrl(data.signed_pdf_url ?? null);
      if (data.audit_trail_url !== undefined) setAuditTrailUrl(data.audit_trail_url ?? null);
    } catch {
      // Non-fatal — stale state is acceptable; next poll will retry
    }
  }, [quoteId]);

  // Poll for status changes every 20 s while the document is pending.
  // Stops once status reaches a terminal state (completed/declined/expired).
  // Also fires immediately on open so stale DB state is refreshed without
  // waiting a full 20-second cycle.
  useEffect(() => {
    if (!isOpen || !quoteId) return;
    if (signatureStatus !== "sent" && signatureStatus !== "viewed") return;
    void refreshSignatureStatus();
    const id = setInterval(refreshSignatureStatus, 20_000);
    return () => clearInterval(id);
  }, [isOpen, quoteId, signatureStatus, refreshSignatureStatus]);

  const handleSave = async () => {
    if (!organizationId) {
      toast.error("No organization found.");
      return;
    }
    setLoading(true);
    try {
      if (quoteId) {
        // ── Save to quote_proposals (per-quote) ──
        if (templateId) {
          const { error } = await supabase
            .from("quote_proposals")
            .update({ pages, recipients, updated_at: new Date().toISOString() })
            .eq("id", templateId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("quote_proposals")
            .insert({ quote_id: quoteId, organization_id: organizationId, pages, recipients })
            .select("id")
            .single();
          if (error) throw error;
          setTemplateId(data.id);
        }
        toast.success("Proposal saved!");
      } else {
        // ── Save to proposal_templates (org-level, original path — unchanged) ──
        if (templateId) {
          const { error } = await supabase
            .from("proposal_templates")
            .update({ pages, updated_at: new Date().toISOString() })
            .eq("id", templateId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("proposal_templates")
            .insert({ organization_id: organizationId, pages })
            .select("id")
            .single();
          if (error) throw error;
          setTemplateId(data.id);
        }
        toast.success("Template saved!");
      }
    } catch (err: any) {
      console.error("Failed to save proposal", err);
      const msg = err?.message ?? "";
      if (msg.includes("relation") && msg.includes("does not exist")) {
        toast.error("Database table not found. Please run the required migration in Supabase first.");
      } else {
        toast.error(msg || "Failed to save");
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Silently persists the current page state to the database without showing
   * user-facing toasts. Used internally by handleDownloadPDF to ensure the
   * export page has the latest data before PDFShift fetches it.
   * Returns true on success, false on failure.
   */
  const doSilentSave = async (): Promise<boolean> => {
    if (!organizationId || !quoteId) return false;
    try {
      if (templateId) {
        const { error } = await supabase
          .from("quote_proposals")
          .update({ pages, recipients, updated_at: new Date().toISOString() })
          .eq("id", templateId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("quote_proposals")
          .insert({ quote_id: quoteId, organization_id: organizationId, pages, recipients })
          .select("id")
          .single();
        if (error) throw error;
        setTemplateId(data.id);
      }
      return true;
    } catch (err) {
      console.error("[doSilentSave] Failed:", err);
      return false;
    }
  };

  const handleDownloadPDF = async () => {
    if (pages.length === 0) { toast.error("No pages to export."); return; }
    setDownloadingPDF(true);
    const toastId = toast.loading("Generating PDF…");

    // Temporary container used to host cloned page nodes for html2canvas capture.
    // It lives at z-index:-9999 so it is never visible but is fully in the DOM
    // and not clipped by any overflow:hidden ancestor.
    const tmpWrapper = document.createElement("div");
    tmpWrapper.setAttribute("data-pdf-capture", "true");
    tmpWrapper.style.cssText =
      "position:fixed;top:0;left:0;z-index:-9999;pointer-events:none;background:white;width:816px;overflow:visible;";
    document.body.appendChild(tmpWrapper);

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      // US Letter in PDF points: 612 × 792 pt (at 72 dpi).
      // Our canvas space is 816 × 1056 px (at 96 dpi).
      // The pixel→point scale is 612/816 = 0.75.
      const PDF_W  = 612;
      const PX_TO_PT = PDF_W / 816; // 0.75

      // Capture at the physical device pixel ratio so text is sharp on Retina
      // displays. The canvas will be dpr× larger in pixel count but is embedded
      // in the PDF at the same logical pt dimensions, giving full-resolution output.
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      // ── Dev-only: log preview dimensions before capture ──────────────────
      if (process.env.NODE_ENV === "development") {
        console.group("[PDF Export] Preview → PDF dimensions");
        pages.forEach((page, i) => {
          const ref = hiddenPageRefs.current[i];
          console.log(
            `Page ${i + 1}: pageHeight=${page.pageHeight ?? 1056}  ` +
            `bgImage=${!!page.backgroundImage}  elements=${page.elements.length}  ` +
            `exportDOM: ${ref?.offsetWidth ?? "?"}×${ref?.offsetHeight ?? "?"}px`
          );
          page.elements.forEach((el) => {
            const base = `  [${el.type}] id=${el.id.slice(0, 8)} x=${el.x} y=${el.y} w=${el.w} h=${el.h}`;
            if (el.type === "text" || el.type === "custom_variable") {
              console.log(`${base} fontSize=${el.styles?.fontSize}`);
            } else if (el.type === "image") {
              const src = el.content ?? "";
              const srcType = src.startsWith("data:") ? "base64" : src.startsWith("blob:") ? "blob" : "public-url";
              console.log(`${base} imgSrc=${srcType} (${src.slice(0, 60)}…)`);
            } else {
              console.log(base);
            }
          });
        });
        console.groupEnd();
      }

      let doc: InstanceType<typeof jsPDF> | null = null;

      for (let i = 0; i < pages.length; i++) {
        const page  = pages[i];
        const pageEl = hiddenPageRefs.current[i];
        if (!pageEl) {
          console.warn(`[PDF] No DOM ref for page ${i + 1} — skipping`);
          continue;
        }

        // Compute capture height BEFORE cloning so minHeight and the inner
        // ProposalPage div both get the correct value.
        // If any element overflows the standard page height, expand to capture it
        // fully — this prevents html2canvas from clipping elements at the bottom.
        const maxElBottom = page.elements.reduce(
          (max, el) => Math.max(max, el.y + el.h),
          PAGE_HEIGHT
        );
        const nodeH = Math.max(PAGE_HEIGHT, maxElBottom);
        const PDF_H = Math.round(nodeH * PX_TO_PT);

        // Clone the off-screen page node into our visible temp container.
        // This avoids html2canvas issues with elements positioned at left:-1200px.
        const clone = pageEl.cloneNode(true) as HTMLDivElement;
        clone.style.position  = "relative";
        clone.style.left      = "0";
        clone.style.top       = "0";
        clone.style.width     = "816px";
        // Use nodeH (not PAGE_HEIGHT) so the clone is tall enough to contain any
        // overflowing absolutely-positioned elements before html2canvas captures.
        clone.style.minHeight = `${nodeH}px`;
        clone.style.background = "#ffffff";

        // When elements overflow the standard 1056 px page, expand the ProposalPage
        // div inside the clone to match nodeH so nothing is clipped by the inner
        // container's fixed height before html2canvas reads the pixels.
        if (nodeH > PAGE_HEIGHT && !page.backgroundImage) {
          const innerPage = clone.firstElementChild as HTMLElement | null;
          if (innerPage) {
            innerPage.style.height = `${nodeH}px`;
            innerPage.style.overflow = "visible";
          }
        }

        // Ensure all images use CORS mode so html2canvas can read pixel data.
        // ProposalExportRenderer already loads them with crossOrigin="anonymous",
        // so the browser cache already has the CORS-enabled version.
        clone.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
          img.crossOrigin = "anonymous";
        });

        tmpWrapper.innerHTML = "";
        tmpWrapper.appendChild(clone);

        // Wait for any images in the clone to finish loading (usually instant
        // since the originals are already cached from ProposalExportRenderer).
        const imgEls = Array.from(clone.querySelectorAll<HTMLImageElement>("img"));
        await Promise.all(
          imgEls.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.onload  = () => resolve();
                  img.onerror = () => {
                    console.warn(`[PDF] Image failed to load on page ${i + 1}:`, img.src?.slice(0, 80));
                    resolve(); // don't block the rest of the PDF
                  };
                })
          )
        );

        if (process.env.NODE_ENV === "development") {
          const cloneH = clone.offsetHeight;
          console.log(
            `[PDF] Page ${i + 1}: cloneH=${cloneH} origH=${pageEl.offsetHeight} ` +
            `capture ${816}×${nodeH}px (×${dpr}dpr) → PDF ${PDF_W}×${PDF_H}pt  ` +
            `images=[${imgEls.map((img) => {
              const s = img.src ?? "";
              return s.startsWith("data:") ? "base64" : s.startsWith("blob:") ? "blob" : "url";
            }).join(", ")}]`
          );
        }

        // Capture the cloned page exactly as the browser renders it.
        // scale:dpr → physical pixel resolution on Retina displays so text in
        // the PDF is as sharp as the browser preview (not half-resolution).
        // The canvas will be 816*dpr × nodeH*dpr physical pixels but is added
        // to jsPDF at the same logical PDF_W×PDF_H pt dimensions.
        const canvas = await html2canvas(clone, {
          useCORS:         true,
          allowTaint:      false,
          backgroundColor: "#ffffff",
          scale:           dpr,
          logging:         false,
          width:           816,
          height:          nodeH,
        });

        // Embed the captured page image into the PDF at the correct dimensions.
        // Lower JPEG quality slightly (0.92) since dpr≥2 gives 4× more pixels anyway.
        const imgData = canvas.toDataURL("image/jpeg", dpr >= 2 ? 0.92 : 0.95);
        if (i === 0) {
          doc = new jsPDF({ unit: "pt", format: [PDF_W, PDF_H], orientation: "portrait" });
        } else {
          doc!.addPage([PDF_W, PDF_H]);
        }
        doc!.addImage(imgData, "JPEG", 0, 0, PDF_W, PDF_H);
      }

      if (!doc) throw new Error("No pages were captured.");

      const filename = quoteName
        ? quoteName.replace(/[^a-z0-9\-_ ]/gi, "").trim() || "proposal"
        : "proposal";
      doc.save(`${filename}.pdf`);
      toast.success("PDF downloaded!", { id: toastId });
    } catch (err: any) {
      console.error("[PDF] Generation failed:", err);
      toast.error(err?.message ?? "Failed to generate PDF", { id: toastId });
    } finally {
      if (document.body.contains(tmpWrapper)) document.body.removeChild(tmpWrapper);
      setDownloadingPDF(false);
    }
  };

  const handleStyleChange = (styles: Partial<NonNullable<typeof selectedElement>["styles"]>) => {
    if (!selectedElementId) return;
    updateElementStyles(selectedElementId, styles, activePageIndex);
    // List formatting is applied via execCommand("insertUnorderedList/insertOrderedList")
    // in ProposalEditorToolbar — scoped to the cursor's paragraph or active selection,
    // not the entire element content.
  };

  /**
   * Apply a font size only to the currently selected text.
   * Uses the execCommand("fontSize") + font-to-span replacement trick because
   * execCommand does not natively support arbitrary pixel sizes.
   */
  const handleFontSizeChange = (size: number) => {
    // Custom variable elements have no contentEditable — font size is an element-level style.
    if (selectedElement?.type === "custom_variable") {
      handleStyleChange({ fontSize: size });
      return;
    }

    const editable = savedEditableRef.current;
    const range = savedRangeRef.current;
    if (!editable || !range) return;

    // Restore focus + selection (dropdown click cleared both)
    editable.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Let the browser wrap the selection in a <font size="7"> element
    document.execCommand("fontSize", false, "7");

    // Replace every such <font> tag with a <span style="font-size: Xpx">
    editable.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement("span");
      span.style.fontSize = `${size}px`;
      while (font.firstChild) span.appendChild(font.firstChild);
      font.parentNode?.replaceChild(span, font);
    });

    // Sync the new HTML back to state
    if (selectedElementId) {
      updateElementContent(selectedElementId, editable.innerHTML, activePageIndex);
    }

    // Update the toolbar size indicator
    setCommandStates((prev) => ({ ...prev, fontSize: size }));
  };

  /** Snap a selected image element to left / center / right of the page. */
  const handleAlignImage = (id: string, targetX: number) => {
    const el = selectedElement;
    if (!el) return;
    moveElement(id, targetX - el.x, 0, activePageIndex);
    commitMove(id, activePageIndex);
  };

  const handleAddElement = (type: ElementType) => {
    if (insertAfterId) {
      insertElementAfter(insertAfterId, type, activePageIndex);
      setInsertAfterId(null);
    } else {
      addElement(type, activePageIndex);
    }
    setShowQuickAdd(false);
  };

  /** Called when the user picks a quote in the QuickAdd quote_picker sub-view. */
  const handleAddQuote = (pickedQuoteId: string, pickedQuoteName: string, pickedQuoteNumber: string) => {
    const content = JSON.stringify({
      quoteId: pickedQuoteId,
      quoteName: pickedQuoteName,
      quoteNumber: pickedQuoteNumber,
    });
    if (insertAfterId) {
      insertElementAfter(insertAfterId, "quote", activePageIndex, content);
      setInsertAfterId(null);
    } else {
      addElement("quote", activePageIndex, content);
    }
    setShowQuickAdd(false);
  };

  /** Called when the user clicks "Change Quote" on an existing quote element. */
  const handleChangeQuoteElement = (elementId: string) => {
    setChangeQuoteElementId(elementId);
    setChangeQuoteSearch("");
  };

  /** Confirms a new quote selection for the currently-editing element. */
  const handleConfirmChangeQuote = (pickedQuoteId: string, pickedQuoteName: string, pickedQuoteNumber: string) => {
    if (!changeQuoteElementId) return;
    const content = JSON.stringify({
      quoteId: pickedQuoteId,
      quoteName: pickedQuoteName,
      quoteNumber: pickedQuoteNumber,
    });
    updateElementContent(changeQuoteElementId, content, activePageIndex);
    setChangeQuoteElementId(null);
  };

  /**
   * User-triggered PDF → PNG pipeline (quote page button, Change Quote).
   * Delegates the heavy lifting to the module-level `uploadQuotePNGs` helper.
   */
  const renderAndInsertQuotePages = async (opts: {
    atIndex: number;
    quoteId: string;
    quoteName: string;
    quoteNumber: string;
    mock?: boolean;
    replaceOldQuoteId?: string;
  }) => {
    if (!organizationId) return;
    setUploading(true);
    const toastId = toast.loading(opts.mock ? "Generating quote placeholder…" : "Generating quote page…");
    try {
      const { urls, heights } = await uploadQuotePNGs(opts.quoteId, organizationId, supabase, opts.mock);
      if (opts.replaceOldQuoteId) {
        replaceQuotePages(opts.atIndex, opts.replaceOldQuoteId, urls, heights, opts.quoteId, opts.quoteName, opts.quoteNumber);
      } else {
        insertQuotePages(opts.atIndex, urls, heights, opts.quoteId, opts.quoteName, opts.quoteNumber);
      }
      toast.success(opts.mock ? "Quote placeholder added!" : `Quote page${heights.length > 1 ? "s" : ""} added!`, { id: toastId });
    } catch (err: any) {
      console.error("[Quote page]", err);
      toast.error(err?.message ?? "Failed to generate quote page", { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  /** Called when user clicks "Quote page" in a page separator.
   *  - Template mode (no quoteId prop): inserts a mock placeholder immediately.
   *  - Quote-log mode (quoteId prop set): opens the quote picker. */
  const handleRequestAddQuotePage = (atIndex: number) => {
    if (!quoteId) {
      // Template builder — insert placeholder with mock PDF, no picker needed
      renderAndInsertQuotePages({
        atIndex,
        quoteId: QUOTE_PLACEHOLDER_ID,
        quoteName: "Quote Placeholder",
        quoteNumber: "SAMPLE-001",
        mock: true,
      });
    } else {
      // Quote-log mode — show picker
      setAddQuotePageAtIndex(atIndex);
      setAddQuotePageSearch("");
    }
  };

  /** Opens the quote picker to replace an existing quote background-image page */
  const handleChangeQuotePage = (pageIndex: number, currentQuoteId: string) => {
    setChangeQuotePageIndex(pageIndex);
    setChangeQuotePageOldId(currentQuoteId);
    setChangeQuotePageSearch("");
  };

  const handleConfirmChangeQuotePage = async (pickedId: string, pickedName: string, pickedNumber: string) => {
    if (changeQuotePageIndex === null) return;
    const idx = changeQuotePageIndex;
    const oldId = changeQuotePageOldId;
    setChangeQuotePageIndex(null);
    setChangeQuotePageOldId("");
    await renderAndInsertQuotePages({
      atIndex: idx,
      quoteId: pickedId,
      quoteName: pickedName,
      quoteNumber: pickedNumber,
      replaceOldQuoteId: oldId,
    });
  };

  const handleConfirmAddQuotePage = async (
    pickedQuoteId: string,
    pickedQuoteName: string,
    pickedQuoteNumber: string,
    replaceFromIndex?: number,
    oldQuoteId?: string
  ) => {
    if (addQuotePageAtIndex === null && replaceFromIndex === undefined) return;
    const atIndex = replaceFromIndex ?? addQuotePageAtIndex!;
    setAddQuotePageAtIndex(null);
    await renderAndInsertQuotePages({
      atIndex,
      quoteId: pickedQuoteId,
      quoteName: pickedQuoteName,
      quoteNumber: pickedQuoteNumber,
      replaceOldQuoteId: oldQuoteId,
    });
  };

  /** Insert a custom_variable element into the active page. */
  const handleAddVariableToDoc = (variableName: string) => {
    const id = insertAfterId
      ? insertElementAfter(insertAfterId, "custom_variable", activePageIndex)
      : addElement("custom_variable", activePageIndex);
    setInsertAfterId(null);
    if (id) updateElementVariableName(id, variableName);
    setShowQuickAdd(false);
  };

  /** Persist a newly created variable name to the org-level list. */
  const handleSaveNewVariable = (name: string) => {
    setCustomVariables((prev) => (prev.includes(name) ? prev : [...prev, name]));
  };

  /** Remove a custom variable from the org-level list. */
  const handleDeleteVariable = (name: string) => {
    setCustomVariables((prev) => prev.filter((v) => v !== name));
  };

  /** Rename a custom variable in the org-level list. */
  const handleRenameVariable = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCustomVariables((prev) =>
      prev.map((v) => (v === oldName ? trimmed : v))
    );
  };

  const handleInsertAfter = (elementId: string, anchorX: number, anchorY: number) => {
    setInsertAfterId(elementId);
    setQuickAddAnchor({ x: anchorX, y: anchorY });
    setShowQuickAdd(true);
  };

  /**
   * Called whenever a text element auto-resizes.
   * Locks the stored height at the page boundary and tracks which elements are overflowing
   * so the warning bar can be shown.
   */
  const handleHeightChange = (id: string, height: number) => {
    // Search every page — avoids a stale activePageIndex/pages closure returning undefined
    let elementY = 0;
    for (const page of pages) {
      const found = page.elements.find((e) => e.id === id);
      if (found) { elementY = found.y; break; }
    }
    const pageBottom = PAGE_HEIGHT - 40;
    const isOverflowing = height > pageBottom - elementY;

    // Cap the stored height so the element never extends past the page in state
    const cappedHeight = Math.min(height, pageBottom - elementY);
    updateElementHeight(id, Math.max(40, cappedHeight), activePageIndex);

    // Track overflow state for the warning bar
    setOverflowedElementIds((prev) => {
      if (isOverflowing === prev.has(id)) return prev; // no change
      const next = new Set(prev);
      isOverflowing ? next.add(id) : next.delete(id);
      return next;
    });
  };

  /** Creates a matching text box on the page after the overflowed element's page. */
  const handleAddToNextPage = (elementId: string) => {
    // Find the element to copy its styles
    let styles = pages[activePageIndex]?.elements.find((e) => e.id === elementId)?.styles;
    if (!styles) {
      for (const page of pages) {
        const found = page.elements.find((e) => e.id === elementId);
        if (found) { styles = found.styles; break; }
      }
    }
    // Remove from overflow set (it will stay locked, warning gone)
    setOverflowedElementIds((prev) => {
      const next = new Set(prev);
      next.delete(elementId);
      return next;
    });
    addTextToNextPage(activePageIndex, styles ?? { fontSize: 14, fontFamily: "Inter", bold: false, italic: false, underline: false, color: "#000000", align: "left", listType: "none" });
  };

  /** Invalidates the stored signing request and unlocks the document for editing. */
  const handleEditDocument = async () => {
    setEditDocumentModalOpen(false);

    // Unlock locally — pages and signing field placements are intentionally kept
    // so the user can edit content and resend without re-placing every field.
    setSignatureStatus(null);
    setExistingSignerLinks([]);
    setSignedPdfUrl(null);
    setAuditTrailUrl(null);

    // Clear the proposal_signatures row so the document is fully unlocked
    if (templateId) {
      try {
        await fetch(`/api/firma/create-signing-request?proposalId=${templateId}`, {
          method: "DELETE",
        });
      } catch (err) {
        console.error("[edit document] Failed to clear signing request:", err);
      }
    }
  };

  if (!isOpen) return null;

  const headerLabel = quoteId ? "Quote Proposal" : "Proposal Template";
  const saveLabel = uploading ? "Uploading…" : loading ? "Saving…" : quoteId ? "Save Proposal" : "Save Template";

  // Document is locked while a signing request is active (sent, viewed, or completed).
  // Edit document must be confirmed to break the lock.
  const isDocumentLocked = signatureStatus === "sent" || signatureStatus === "viewed" || signatureStatus === "completed";

  const sigStatusColors: Record<ProposalSignatureStatus, string> = {
    draft:     "bg-gray-100 text-gray-600",
    sent:      "bg-blue-100 text-blue-700",
    viewed:    "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700",
    declined:  "bg-red-100 text-red-600",
    expired:   "bg-gray-100 text-gray-500",
    failed:    "bg-red-50 text-red-500",
  };
  const sigStatusLabel: Record<ProposalSignatureStatus, string> = {
    draft: "Draft", sent: "Sent", viewed: "Viewed",
    completed: "Completed", declined: "Declined", expired: "Expired", failed: "Failed",
  };

  const innerContent = (
    <div className={inline
      ? "bg-white dark:bg-gray-900 flex flex-col w-full h-full overflow-hidden"
      : "bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-6xl h-[92vh] overflow-hidden"
    }>
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 bg-white flex-shrink-0">
          <div className="flex items-center gap-1 py-1">
            <button
              onClick={() => setActiveTab("editor")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
                activeTab === "editor"
                  ? "text-gray-900 border-b-2 border-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <FileEdit size={15} />
              PDF Editor
            </button>
            <button
              onClick={() => { setActiveTab("view"); setSelectedElementId(null); }}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
                activeTab === "view"
                  ? "text-gray-900 border-b-2 border-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Eye size={15} />
              PDF View
            </button>
            {/* Recipients tab — only shown when editing a quote proposal */}
            {quoteId && (
              <button
                onClick={() => { setActiveTab("recipients"); setSelectedElementId(null); }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t transition-colors ${
                  activeTab === "recipients"
                    ? "text-gray-900 border-b-2 border-gray-900"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Users size={15} />
                Recipients
                {recipients.length > 0 && recipientsAutoSave === "idle" && (
                  <span className="ml-0.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded-full w-4 h-4 flex items-center justify-center">
                    {recipients.length}
                  </span>
                )}
                {recipientsAutoSave === "saving" && (
                  <span className="ml-0.5 text-xs text-gray-400 font-normal">saving…</span>
                )}
                {recipientsAutoSave === "saved" && (
                  <span className="ml-0.5 text-xs text-green-600 font-normal">saved ✓</span>
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {inline ? (
              <div className="relative flex items-center gap-2" ref={sendDropdownRef}>
                {/* Signature status badge */}
                {signatureStatus && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sigStatusColors[signatureStatus]}`}>
                    {sigStatusLabel[signatureStatus]}
                  </span>
                )}

                {isDocumentLocked ? (
                  /* ── Actions dropdown (document locked / already sent) ── */
                  <>
                    <button
                      onClick={() => setSendDropdownOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[#2d4a2d] hover:bg-[#243d24] transition-colors px-3.5 py-1.5 rounded-md"
                    >
                      Actions
                      <ChevronDown size={12} strokeWidth={2.5} />
                    </button>

                    {sendDropdownOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
                        {/* Completed: signed PDF + audit trail; Sent/Viewed: share link */}
                        {signatureStatus === "completed" ? (
                          <>
                            {signedPdfUrl && (
                              <a
                                href={signedPdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setSendDropdownOpen(false)}
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                              >
                                <Download size={14} className="text-gray-400" />
                                View signed document
                              </a>
                            )}
                            {auditTrailUrl && (
                              <a
                                href={auditTrailUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setSendDropdownOpen(false)}
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                              >
                                <ExternalLink size={14} className="text-gray-400" />
                                Audit trail
                              </a>
                            )}
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              setSendDropdownOpen(false);
                              setShareLinkOpen(true);
                            }}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            <Link2 size={14} className="text-gray-400" />
                            Share via link
                          </button>
                        )}
                        {/* Download PDF — always available regardless of signature status */}
                        <button
                          onClick={() => {
                            setSendDropdownOpen(false);
                            handleDownloadPDF();
                          }}
                          disabled={downloadingPDF}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Download size={14} className="text-gray-400" />
                          {downloadingPDF ? "Generating…" : "Download PDF"}
                        </button>
                        <button
                          onClick={() => {
                            setSendDropdownOpen(false);
                            setEditDocumentModalOpen(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <FileEdit size={14} className="text-gray-400" />
                          Edit document
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  /* ── Send dropdown (document editable / not yet sent) ── */
                  <>
                    <button
                      onClick={() => setSendDropdownOpen((v) => !v)}
                      disabled={downloadingPDF || uploading}
                      className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[#2d4a2d] hover:bg-[#243d24] disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3.5 py-1.5 rounded-md"
                    >
                      Send
                      <ChevronDown size={12} strokeWidth={2.5} />
                    </button>

                    {sendDropdownOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
                        <button
                          onClick={() => {
                            setSendDropdownOpen(false);
                            handleDownloadPDF();
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Download size={14} className="text-gray-400" />
                          {downloadingPDF ? "Generating…" : "Download"}
                        </button>
                        <button
                          onClick={() => {
                            setSendDropdownOpen(false);
                            doSilentSave().then(() => setShareLinkOpen(true));
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Link2 size={14} className="text-gray-400" />
                          Link
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                <span className="text-xs text-gray-400">{headerLabel}</span>
                <button
                  onClick={onClose}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Toolbar (editor only) — greyed out while document is locked */}
        {activeTab === "editor" && (
          <ProposalEditorToolbar
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            selectedStyles={selectedElement?.styles ?? null}
            onStyleChange={handleStyleChange}
            onFontSizeChange={handleFontSizeChange}
            commandStates={commandStates}
            disabled={isDocumentLocked}
          />
        )}

        {/* Document-state banner */}
        {isDocumentLocked && (
          signatureStatus === "completed" ? (
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-green-50 border-b border-green-100 flex-shrink-0">
              <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
              <p className="text-sm font-medium text-green-800">
                {"It's a wrap! This document has been completed by all participants."}
              </p>
            </div>
          ) : signatureStatus === "viewed" ? (
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex-shrink-0">
              <ArrowRight size={14} className="text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                The document has been opened by a recipient and is awaiting signatures.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex-shrink-0">
              <ArrowRight size={14} className="text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                The document has been sent. Click the links to share and sign the document.
              </p>
            </div>
          )
        )}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden relative">
          {activeTab === "recipients" ? (
            /* ── Recipients panel — always rendered immediately, no loading gate ── */
            <div className="flex-1 overflow-hidden">
              <ProposalRecipientsPanel
                recipients={recipients}
                onChange={setRecipients}
                organizationId={organizationId}
              />
            </div>
          ) : initializing ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Loading template…
            </div>
          ) : signatureStatus === "completed" && signedPdfUrl ? (
            /* ── Completed: show the signed PDF instead of the editable draft ── */
            <div className="flex-1 overflow-auto bg-gray-100 flex flex-col items-center">
              <div className="w-full max-w-[850px] mx-auto py-5 px-4 flex flex-col gap-3 min-h-full">
                <div className="flex items-center justify-between px-1">
                  <p className="text-sm font-medium text-gray-600">Completed signed document</p>
                  <a
                    href={signedPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    Open in new tab
                    <ExternalLink size={11} />
                  </a>
                </div>
                <iframe
                  src={signedPdfUrl}
                  title="Signed document"
                  className="w-full flex-1 min-h-[800px] rounded-lg border border-gray-200 shadow bg-white"
                />
              </div>
            </div>
          ) : (
            <>
              <ProposalCanvas
                pages={pages}
                activePageIndex={activePageIndex}
                selectedElementId={selectedElementId}
                isReadOnly={isDocumentLocked || activeTab === "view"}
                overflowedElementIds={overflowedElementIds}
                onAddToNextPage={handleAddToNextPage}
                onSelectElement={setSelectedElementId}
                onDeselectElement={() => setSelectedElementId(null)}
                onMoveElement={moveElement}
                onCommitMove={commitMove}
                onResizeElement={resizeElement}
                onCommitResize={commitResize}
                onAlignImage={handleAlignImage}
                onDuplicateElement={duplicateElement}
                onDeleteElement={deleteElement}
                onContentChange={(id, content) =>
                  updateElementContent(id, content, activePageIndex)
                }
                onCustomVarSync={syncCustomVarContentByName}
                onVariableNameChange={(id, name) =>
                  updateElementVariableName(id, name, activePageIndex)
                }
                onHeightChange={handleHeightChange}
                onInsertAfter={handleInsertAfter}
                onRequestAddElement={(anchorX, anchorY) => {
                  setQuickAddAnchor({ x: anchorX, y: anchorY });
                  setInsertAfterId(null);
                  setShowQuickAdd(true);
                }}
                onSetActivePage={setActivePageIndex}
                onInsertPage={insertPageAt}
                onDuplicatePage={duplicatePage}
                onDeletePage={deletePage}
                onUploadFile={handleUploadFile}
                recipients={recipients}
                onChangeQuote={handleChangeQuoteElement}
                onAddQuotePage={handleRequestAddQuotePage}
                onChangeQuotePage={handleChangeQuotePage}
              />

              {/* Right panel */}
              {activeTab === "editor" && (
                <ProposalFieldManager
                  pages={pages}
                  selectedElementId={selectedElementId}
                  onSelectElement={setSelectedElementId}
                  onNavigateToPage={setActivePageIndex}
                />
              )}
            </>
          )}
        </div>


        {/* Change Quote picker overlay */}
        {changeQuoteElementId && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <span className="text-sm font-semibold text-gray-700">Change Quote</span>
                <button
                  onClick={() => setChangeQuoteElementId(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="px-3 py-2 flex-shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <Search size={13} className="text-gray-400 flex-shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    value={changeQuoteSearch}
                    onChange={(e) => setChangeQuoteSearch(e.target.value)}
                    placeholder="Search quotes…"
                    className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
                {availableQuotes
                  .filter(
                    (q) =>
                      q.quote_name.toLowerCase().includes(changeQuoteSearch.toLowerCase()) ||
                      q.quote_number.toLowerCase().includes(changeQuoteSearch.toLowerCase())
                  )
                  .map((q) => (
                    <button
                      key={q.id}
                      onClick={() => handleConfirmChangeQuote(q.id, q.quote_name, q.quote_number)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-green-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-800 truncate">
                        #{q.quote_number} — {q.quote_name}
                      </p>
                    </button>
                  ))}
                {availableQuotes.length === 0 && (
                  <p className="text-xs text-gray-400 italic text-center py-6">No quotes found.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Add Quote Page picker overlay */}
        {addQuotePageAtIndex !== null && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <span className="text-sm font-semibold text-gray-700">Select a Quote</span>
                <button
                  onClick={() => setAddQuotePageAtIndex(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                >
                  <X size={14} />
                </button>
              </div>
              {/* Current quote shortcut */}
              {quoteId && (() => {
                const current = availableQuotes.find((q) => q.id === quoteId);
                return current ? (
                  <div className="px-3 pt-3 pb-2 flex-shrink-0">
                    <button
                      onClick={() => handleConfirmAddQuotePage(current.id, current.quote_name, current.quote_number)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors text-left"
                    >
                      <Plus size={14} className="flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate leading-tight">Use current quote</p>
                        <p className="text-xs text-green-200 truncate leading-tight">
                          #{current.quote_number} — {current.quote_name}
                        </p>
                      </div>
                    </button>
                  </div>
                ) : null;
              })()}
              <div className="px-3 py-2 flex-shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <Search size={13} className="text-gray-400 flex-shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    value={addQuotePageSearch}
                    onChange={(e) => setAddQuotePageSearch(e.target.value)}
                    placeholder="Search quotes…"
                    className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
                {availableQuotes
                  .filter(
                    (q) =>
                      q.quote_name.toLowerCase().includes(addQuotePageSearch.toLowerCase()) ||
                      q.quote_number.toLowerCase().includes(addQuotePageSearch.toLowerCase())
                  )
                  .map((q) => (
                    <button
                      key={q.id}
                      onClick={() => handleConfirmAddQuotePage(q.id, q.quote_name, q.quote_number)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-green-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-800 truncate">
                        #{q.quote_number} — {q.quote_name}
                      </p>
                    </button>
                  ))}
                {availableQuotes.length === 0 && (
                  <p className="text-xs text-gray-400 italic text-center py-6">No quotes found.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Change Quote Page picker overlay */}
        {changeQuotePageIndex !== null && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <span className="text-sm font-semibold text-gray-700">Change Quote</span>
                <button
                  onClick={() => setChangeQuotePageIndex(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="px-3 py-2 flex-shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <Search size={13} className="text-gray-400 flex-shrink-0" />
                  <input
                    autoFocus
                    type="text"
                    value={changeQuotePageSearch}
                    onChange={(e) => setChangeQuotePageSearch(e.target.value)}
                    placeholder="Search quotes…"
                    className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
                {availableQuotes
                  .filter(
                    (q) =>
                      q.quote_name.toLowerCase().includes(changeQuotePageSearch.toLowerCase()) ||
                      q.quote_number.toLowerCase().includes(changeQuotePageSearch.toLowerCase())
                  )
                  .map((q) => (
                    <button
                      key={q.id}
                      onClick={() => handleConfirmChangeQuotePage(q.id, q.quote_name, q.quote_number)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-green-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-800 truncate">
                        #{q.quote_number} — {q.quote_name}
                      </p>
                    </button>
                  ))}
                {availableQuotes.length === 0 && (
                  <p className="text-xs text-gray-400 italic text-center py-6">No quotes found.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Edit document confirmation modal */}
        {editDocumentModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Edit this document?
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {"The current signing link will be invalidated. Your signature and initials fields will stay in place, but you'll need to resend the document so recipients can sign the updated version."}
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setEditDocumentModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditDocument}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                >
                  Edit document
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div data-footer className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-white flex-shrink-0">
          {/* Add element — hidden while document is locked */}
          {activeTab === "editor" && !isDocumentLocked ? (
            <div className="flex items-center gap-3 relative">
              <button
                onClick={(e) => {
                  // Anchor to the footer bar so the popover appears just above it, centered
                  const rect = e.currentTarget.closest("footer, [data-footer]")?.getBoundingClientRect()
                    ?? e.currentTarget.getBoundingClientRect();
                  setQuickAddAnchor({ x: window.innerWidth / 2, y: rect.top });
                  setInsertAfterId(null);
                  setShowQuickAdd((v) => !v);
                }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
                title="Add element"
              >
                <Plus size={15} />
                Add element
              </button>

              {showQuickAdd && quickAddAnchor && (
                <ProposalQuickAdd
                  anchorX={quickAddAnchor.x}
                  anchorY={quickAddAnchor.y}
                  customVariables={customVariables}
                  onAdd={handleAddElement}
                  onClose={() => { setShowQuickAdd(false); setInsertAfterId(null); }}
                  onAddVariable={handleAddVariableToDoc}
                  onSaveNewVariable={handleSaveNewVariable}
                  onDeleteVariable={handleDeleteVariable}
                  onRenameVariable={handleRenameVariable}
                  quotes={availableQuotes}
                  currentQuoteId={quoteId}
                  onAddQuote={handleAddQuote}
                />
              )}
            </div>
          ) : (
            <div />
          )}

          <button
            onClick={handleSave}
            disabled={loading || uploading || isDocumentLocked}
            className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={15} />
            {saveLabel}
          </button>
        </div>
      </div>
  );

  /**
   * ProposalExportRenderer portals to document.body — completely outside
   * the editor's overflow:hidden container and any ancestor transforms.
   * This is the ONLY render used for PDF export.
   * The old inline hidden container (opacity:0 inside overflow:hidden) has
   * been removed because opacity:0 caused html2canvas to capture blank pages.
   */
  // ProposalExportRenderer stays mounted off-screen so html2canvas can
  // read layout (offsetWidth/offsetHeight/getBCR) from hiddenPageRefs.
  // PDF capture uses a separate createRoot temp container (see handleDownloadPDF).
  const exportRenderer = (
    <ProposalExportRenderer
      pages={pages}
      onPageRef={(idx, el) => { hiddenPageRefs.current[idx] = el; }}
    />
  );

  const shareLinkModal = quoteId ? (
    <ProposalShareLinkModal
      isOpen={shareLinkOpen}
      onClose={() => setShareLinkOpen(false)}
      quoteId={quoteId}
      quoteName={quoteName}
      recipients={recipients}
      pages={pages}
      existingLinks={existingSignerLinks}
      currentSignatureStatus={signatureStatus}
      onLinksGenerated={(status, links) => {
        setSignatureStatus(status);
        if (links && links.length > 0) setExistingSignerLinks(links);
      }}
      onRefreshStatus={() => { void refreshSignatureStatus(); }}
    />
  ) : null;

  if (inline) return <>{exportRenderer}{innerContent}{shareLinkModal}</>;

  return (
    <>
      {exportRenderer}
      {shareLinkModal}
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        {innerContent}
      </div>
    </>
  );
}
