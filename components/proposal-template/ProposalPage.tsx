"use client";

import { Plus } from "lucide-react";
import { ProposalRecipient, ResizeHandle, TemplatePage, QUOTE_PLACEHOLDER_ID } from "./proposalTemplateTypes";
import ProposalElement from "./ProposalElement";
import { QuoteWithProfile } from "./QuoteBlock";

// ── Document dimension constants ────────────────────────────────────────────
// 816 px wide = 8.5 inches at 96 dpi (US Letter)
export const PAGE_WIDTH = 816;
// 1056 px tall = 11 inches at 96 dpi (US Letter)
export const PAGE_HEIGHT = 1056;
// Scale factor applied in the editor canvas preview
export const PAGE_SCALE = 0.82;
// Visual dimensions after applying the preview scale
export const PAGE_VISUAL_WIDTH  = Math.round(PAGE_WIDTH  * PAGE_SCALE); // 669
export const PAGE_VISUAL_HEIGHT = Math.round(PAGE_HEIGHT * PAGE_SCALE); // 866

interface ProposalPageProps {
  page: TemplatePage;
  pageIndex: number;
  isActive: boolean;
  isReadOnly?: boolean;
  /** Custom height override (unscaled px). Defaults to PAGE_HEIGHT. */
  pageHeight?: number;
  /** When true the component renders only elements with no background fill.
   *  Used in the overlay layer on top of a full-page background image. */
  transparent?: boolean;
  /** Remove the drop shadow (used during PDF export). */
  noShadow?: boolean;
  selectedElementId: string | null;
  overflowedElementIds?: Set<string>;
  onAddToNextPage?: (elementId: string) => void;
  onSelectElement: (id: string) => void;
  onDeselect: () => void;
  onMoveStart: (id: string, startX: number, startY: number) => void;
  onResizeStart: (
    id: string,
    handle: ResizeHandle,
    clientX: number,
    clientY: number,
    startEl: { x: number; y: number; w: number; h: number; elementType?: string }
  ) => void;
  onAlignImage: (id: string, targetX: number) => void;
  onDuplicateElement: (id: string) => void;
  onDeleteElement: (id: string) => void;
  onContentChange: (id: string, content: string) => void;
  onHeightChange: (id: string, height: number) => void;
  onInsertAfter: (id: string, anchorX: number, anchorY: number) => void;
  onRequestAddElement?: (anchorX: number, anchorY: number) => void;
  onVariableNameChange?: (id: string, name: string) => void;
  recipients?: ProposalRecipient[];
  onChangeQuote?: (elementId: string) => void;
  quoteDataMap?: Record<string, QuoteWithProfile>;
}

export default function ProposalPage({
  page,
  isActive,
  isReadOnly = false,
  pageHeight,
  transparent = false,
  noShadow = false,
  selectedElementId,
  overflowedElementIds,
  onAddToNextPage,
  onSelectElement,
  onDeselect,
  onMoveStart,
  onResizeStart,
  onAlignImage,
  onDuplicateElement,
  onDeleteElement,
  onContentChange,
  onHeightChange,
  onInsertAfter,
  onRequestAddElement,
  onVariableNameChange,
  recipients = [],
  onChangeQuote,
  quoteDataMap,
}: ProposalPageProps) {
  const effectiveH = pageHeight ?? PAGE_HEIGHT;

  // Elements that have grown below the page boundary
  const overflowed = page.elements.filter((el) => overflowedElementIds?.has(el.id));

  return (
    <div
      style={{ width: PAGE_WIDTH, height: effectiveH }}
      className={[
        "relative overflow-visible",
        transparent ? "" : "bg-white",
        noShadow    ? "" : "shadow-lg",
      ].join(" ")}
      onMouseDown={(e) => {
        if (isReadOnly) return;
        if (e.target === e.currentTarget) onDeselect();
      }}
    >
      {/* ── Full-page background image (editor mode, non-transparent) ── */}
      {!transparent && page.backgroundImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.backgroundImage}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "fill",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />
      )}

      {/* ── Placeholder badge (template editor only, quote placeholder pages) ── */}
      {!transparent && !isReadOnly && page.quoteId === QUOTE_PLACEHOLDER_ID && (
        <div
          style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 30 }}
          className="pointer-events-none"
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wide bg-amber-100 text-amber-800 border border-amber-300 shadow-sm select-none">
            ✦ Quote Placeholder — replaced when proposal is generated
          </span>
        </div>
      )}

      {/* ── Blank page prompt (edit mode, empty page) ─────────────────── */}
      {!isReadOnly && !page.backgroundImage && page.elements.length === 0 && (
        <div className="absolute inset-x-0 top-0 flex justify-center pt-3 z-20">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRequestAddElement?.(PAGE_WIDTH / 2, effectiveH / 2);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 hover:bg-white text-gray-800 text-sm font-medium rounded-lg shadow transition-colors select-none border border-gray-200"
          >
            <Plus size={15} />
            Add element
          </button>
        </div>
      )}

      {/* ── Elements ───────────────────────────────────────────────────── */}
      {page.elements.map((el) => (
        <ProposalElement
          key={el.id}
          element={el}
          isSelected={el.id === selectedElementId}
          isReadOnly={isReadOnly}
          showOverflowWarning={overflowedElementIds?.has(el.id) ?? false}
          onSelect={onSelectElement}
          onMoveStart={onMoveStart}
          onDuplicate={onDuplicateElement}
          onDelete={onDeleteElement}
          onContentChange={onContentChange}
          onHeightChange={onHeightChange}
          onInsertAfter={onInsertAfter}
          onResizeStart={onResizeStart}
          onAlignImage={onAlignImage}
          onVariableNameChange={onVariableNameChange}
          recipients={recipients}
          onChangeQuote={onChangeQuote}
          quoteDataMap={quoteDataMap}
        />
      ))}

      {/* ── Active page highlight ring (edit mode) ─────────────────────── */}
      {isActive && !isReadOnly && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ outline: "2px solid #3b82f6", outlineOffset: -2, zIndex: 10 }}
        />
      )}

      {/* ── Overflow warning bar ───────────────────────────────────────── */}
      {!isReadOnly && overflowed.length > 0 && (
        <div
          className="absolute bottom-0 inset-x-0 bg-orange-500/90 text-white text-[11px] font-medium flex items-center justify-between px-3 py-1.5"
          style={{ zIndex: 20 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span>
            {overflowed.length} element{overflowed.length > 1 ? "s" : ""} overflow{overflowed.length === 1 ? "s" : ""} the page
          </span>
          {onAddToNextPage && (
            <button
              className="ml-3 underline hover:no-underline"
              onClick={(e) => {
                e.stopPropagation();
                overflowed.forEach((el) => onAddToNextPage(el.id));
              }}
            >
              Move to next page
            </button>
          )}
        </div>
      )}
    </div>
  );
}
