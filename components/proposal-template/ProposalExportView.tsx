"use client";

import { TemplatePage } from "./proposalTemplateTypes";
import ProposalPage, { PAGE_HEIGHT, PAGE_WIDTH } from "./ProposalPage";
import { QuoteWithProfile } from "./QuoteBlock";

interface ProposalExportViewProps {
  pages: TemplatePage[];
  /** Pre-fetched quote data for any quote elements in the proposal */
  quoteDataMap?: Record<string, QuoteWithProfile>;
  /**
   * Server-prefetched base64 data URIs keyed by the original Supabase URL.
   * When present, the <img> tag uses the data URI instead of the remote URL so
   * PDFShift receives a fully self-contained document — no external requests,
   * no timing race on image load.
   */
  backgroundImageDataUrls?: Record<string, string>;
}

/**
 * ProposalExportView
 *
 * Renders proposal pages at their natural (unscaled) size for PDF export.
 * Consumed by:
 *   - /proposal/export/[quoteId] — the page PDFShift fetches and renders
 *
 * Design rules:
 *   - No editor chrome (no toolbar, sidebar, selection handles, add-element buttons)
 *   - No CSS scale transform — pages render at true 816×1056 px
 *   - Background images render as full-bleed <img> tags (Supabase public URLs)
 *   - PDFShift uses a fixed delay (not wait_for) since proposal content is
 *     fully present in the SSR HTML — no JS selector polling needed
 */
export default function ProposalExportView({ pages, quoteDataMap, backgroundImageDataUrls }: ProposalExportViewProps) {

  return (
    <>
      <style>{`
        /* Remove all browser default print margins so each proposal page
           maps 1:1 to a PDF page with no overflow or leftover blank space. */
        @page { margin: 0; size: letter portrait; }
        @media print {
          html, body { margin: 0; padding: 0; }
          .proposal-export-page { page-break-after: always; break-after: page; }
          .proposal-export-page:last-child { page-break-after: avoid; break-after: avoid; }
          img { max-width: 100%; }
        }
      `}</style>

      {/* No padding / minHeight here — decorative spacing must not appear in PDF */}
      <div style={{ background: "#f3f4f6" }}>
        {pages.map((page, idx) => {
          const pageH = page.pageHeight ?? PAGE_HEIGHT;
          // Use the server-prefetched base64 data URI when available so the
          // browser (PDFShift) never needs to make an external image request.
          const bgSrc = page.backgroundImage
            ? (backgroundImageDataUrls?.[page.backgroundImage] ?? page.backgroundImage)
            : undefined;

          return (
            <div
              key={page.id}
              className="proposal-export-page"
              style={{
                width: PAGE_WIDTH,
                // Explicit height prevents the container from collapsing to
                // 0 px if an image fails to load (height:auto fallback).
                height: pageH,
                margin: "0 auto",
                // No marginBottom — inter-page gaps misalign PDF page boundaries
                position: "relative",
                background: "#ffffff",
              }}
            >
              {bgSrc ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={bgSrc}
                    alt=""
                    draggable={false}
                    style={{ display: "block", width: "100%", height: "100%" }}
                  />
                  {page.elements.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: PAGE_WIDTH,
                        height: pageH,
                        pointerEvents: "none",
                      }}
                    >
                      <ProposalPage
                        page={page}
                        pageIndex={idx}
                        isActive={false}
                        isReadOnly
                        pageHeight={pageH}
                        transparent
                        noShadow
                        selectedElementId={null}
                        quoteDataMap={quoteDataMap}
                        onSelectElement={() => {}}
                        onDeselect={() => {}}
                        onMoveStart={() => {}}
                        onResizeStart={() => {}}
                        onAlignImage={() => {}}
                        onDuplicateElement={() => {}}
                        onDeleteElement={() => {}}
                        onContentChange={() => {}}
                        onHeightChange={() => {}}
                        onInsertAfter={() => {}}
                      />
                    </div>
                  )}
                </>
              ) : (
                <ProposalPage
                  page={page}
                  pageIndex={idx}
                  isActive={false}
                  isReadOnly
                  pageHeight={pageH}
                  noShadow
                  selectedElementId={null}
                  quoteDataMap={quoteDataMap}
                  onSelectElement={() => {}}
                  onDeselect={() => {}}
                  onMoveStart={() => {}}
                  onResizeStart={() => {}}
                  onAlignImage={() => {}}
                  onDuplicateElement={() => {}}
                  onDeleteElement={() => {}}
                  onContentChange={() => {}}
                  onHeightChange={() => {}}
                  onInsertAfter={() => {}}
                />
              )}
            </div>
          );
        })}

      </div>
    </>
  );
}
