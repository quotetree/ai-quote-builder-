"use client";

import { useCallback, useEffect, useRef } from "react";
import { ProposalRecipient, ResizeHandle, TemplatePage } from "./proposalTemplateTypes";
import { QuoteWithProfile } from "./QuoteBlock";
import ProposalPage, {
  PAGE_HEIGHT,
  PAGE_SCALE,
  PAGE_VISUAL_HEIGHT,
  PAGE_VISUAL_WIDTH,
  PAGE_WIDTH,
} from "./ProposalPage";
import ProposalPageSeparator from "./ProposalPageSeparator";

interface DragState {
  elementId: string;
}

interface ResizeState {
  elementId: string;
  handle: ResizeHandle;
  startClientX: number;
  startClientY: number;
  startEl: { x: number; y: number; w: number; h: number; elementType?: string };
}

interface ProposalCanvasProps {
  pages: TemplatePage[];
  activePageIndex: number;
  selectedElementId: string | null;
  isReadOnly?: boolean;
  overflowedElementIds?: Set<string>;
  onAddToNextPage?: (elementId: string) => void;
  onSelectElement: (id: string) => void;
  onDeselectElement: () => void;
  onMoveElement: (elementId: string, dx: number, dy: number, pageIndex: number) => void;
  onCommitMove: (elementId: string, pageIndex: number) => void;
  onResizeElement: (id: string, w: number, h: number, x: number, y: number, pageIndex: number) => void;
  onCommitResize: (id: string, pageIndex: number) => void;
  onAlignImage: (id: string, targetX: number) => void;
  onDuplicateElement: (id: string) => void;
  onDeleteElement: (id: string) => void;
  onContentChange: (id: string, content: string) => void;
  onCustomVarSync?: (variableName: string, content: string) => void;
  onHeightChange: (id: string, height: number) => void;
  onInsertAfter: (id: string, anchorX: number, anchorY: number) => void;
  onRequestAddElement?: (anchorX: number, anchorY: number) => void;
  /** Called when any page is clicked so the modal can sync activePageIndex */
  onSetActivePage?: (pageIndex: number) => void;
  onVariableNameChange?: (id: string, name: string) => void;
  onInsertPage: (atIndex: number) => void;
  onDuplicatePage: (pageIndex: number) => void;
  onDeletePage: (pageIndex: number) => void;
  onUploadFile?: (atIndex: number, files: FileList) => void;
  recipients?: ProposalRecipient[];
  onChangeQuote?: (elementId: string) => void;
  quoteDataMap?: Record<string, QuoteWithProfile>;
  onAddQuotePage?: (atIndex: number) => void;
  onChangeQuotePage?: (pageIndex: number, currentQuoteId: string) => void;
}

export default function ProposalCanvas({
  pages,
  activePageIndex,
  selectedElementId,
  isReadOnly = false,
  overflowedElementIds,
  onAddToNextPage,
  onSelectElement,
  onDeselectElement,
  onMoveElement,
  onCommitMove,
  onResizeElement,
  onCommitResize,
  onAlignImage,
  onDuplicateElement,
  onDeleteElement,
  onContentChange,
  onCustomVarSync,
  onHeightChange,
  onInsertAfter,
  onRequestAddElement,
  onSetActivePage,
  onVariableNameChange,
  onInsertPage,
  onDuplicatePage,
  onDeletePage,
  onUploadFile,
  recipients = [],
  onChangeQuote,
  quoteDataMap,
  onAddQuotePage,
  onChangeQuotePage,
}: ProposalCanvasProps) {
  const dragRef = useRef<DragState | null>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const resizeDragRef = useRef<ResizeState | null>(null);
  // One ref per page — used to scroll the canvas to the active page
  const pageRefsMap = useRef<Map<number, HTMLDivElement | null>>(new Map());

  const handleMoveStart = useCallback(
    (elementId: string, startX: number, startY: number) => {
      dragRef.current = { elementId };
      lastPos.current = { x: startX, y: startY };
    },
    []
  );

  const handleResizeStart = useCallback(
    (
      elementId: string,
      handle: ResizeHandle,
      clientX: number,
      clientY: number,
      startEl: { x: number; y: number; w: number; h: number }
    ) => {
      resizeDragRef.current = { elementId, handle, startClientX: clientX, startClientY: clientY, startEl };
    },
    []
  );

  // Scroll to the active page whenever it changes (e.g. clicked from field manager)
  useEffect(() => {
    const el = pageRefsMap.current.get(activePageIndex);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activePageIndex]);

  // After the page scrolls, bring the selected element into view within the canvas.
  // Runs after selectedElementId changes (e.g. field manager click) with a short
  // delay so the page-level scroll above can settle first.
  useEffect(() => {
    if (!selectedElementId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-element-id="${selectedElementId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 120);
    return () => clearTimeout(timer);
  }, [selectedElementId]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      // --- Move ---
      if (dragRef.current && lastPos.current) {
        const dx = (e.clientX - lastPos.current.x) / PAGE_SCALE;
        const dy = (e.clientY - lastPos.current.y) / PAGE_SCALE;
        lastPos.current = { x: e.clientX, y: e.clientY };
        onMoveElement(dragRef.current.elementId, dx, dy, activePageIndex);
      }
      // --- Resize (corners only) ---
      if (resizeDragRef.current) {
        const { elementId, handle, startClientX, startClientY, startEl } = resizeDragRef.current;
        const rawDx = (e.clientX - startClientX) / PAGE_SCALE;
        const rawDy = (e.clientY - startClientY) / PAGE_SCALE;
        const freeResize = startEl.elementType !== "image";

        let newW: number;
        let newH: number;
        let newX = startEl.x;
        let newY = startEl.y;

        if (freeResize) {
          // Free-form: width and height resize independently
          newW = (handle === "sw" || handle === "nw")
            ? Math.max(40, startEl.w - rawDx)
            : Math.max(40, startEl.w + rawDx);
          newH = (handle === "nw" || handle === "ne")
            ? Math.max(20, startEl.h - rawDy)
            : Math.max(20, startEl.h + rawDy);
          if (handle === "sw" || handle === "nw") newX = startEl.x + startEl.w - newW;
          if (handle === "nw" || handle === "ne") newY = startEl.y + startEl.h - newH;
        } else {
          // Aspect-ratio locked (images): use horizontal axis as primary
          const ratio = startEl.h > 0 ? startEl.w / startEl.h : 1;
          const delta = (handle === "sw" || handle === "nw") ? -rawDx : rawDx;
          newW = Math.max(40, startEl.w + delta);
          newH = newW / ratio;
          if (handle === "sw" || handle === "nw") newX = startEl.x + startEl.w - newW;
          if (handle === "nw" || handle === "ne") newY = startEl.y + startEl.h - newH;
        }

        onResizeElement(elementId, newW, newH, Math.max(0, newX), Math.max(0, newY), activePageIndex);
      }
    };

    const onMouseUp = () => {
      if (dragRef.current) {
        onCommitMove(dragRef.current.elementId, activePageIndex);
        dragRef.current = null;
        lastPos.current = null;
      }
      if (resizeDragRef.current) {
        onCommitResize(resizeDragRef.current.elementId, activePageIndex);
        resizeDragRef.current = null;
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [activePageIndex, onMoveElement, onCommitMove, onResizeElement, onCommitResize]);

  return (
    <div
      className="flex-1 overflow-auto bg-gray-100 flex flex-col py-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDeselectElement();
      }}
    >
      {pages.map((page, idx) => (
        <div
          key={page.id}
          ref={(el) => { pageRefsMap.current.set(idx, el); }}
        >
          {/* Separator above every page (including the first) */}
          {!isReadOnly ? (
            <ProposalPageSeparator
              insertAtIndex={idx}
              managePageIndex={idx}
              onInsertBlankPage={onInsertPage}
              onDuplicatePage={onDuplicatePage}
              onDeletePage={onDeletePage}
              onUploadFile={onUploadFile}
              onAddQuotePage={onAddQuotePage}
              managedPageQuoteId={pages[idx]?.quoteId}
              onChangeQuotePage={onChangeQuotePage}
            />
          ) : (
            /* Read-only page break — visible gap + page label (skip above page 1) */
            <div
              className={`flex items-center bg-gray-100 px-5 ${
                idx === 0 ? "h-4" : "h-10"
              }`}
            >
              {idx > 0 && (
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                  Page {idx + 1}
                </span>
              )}
            </div>
          )}

          {/* Page wrapper — sized to visual dimensions so no dead space below */}
          {(() => {
            const ph  = page.pageHeight ?? PAGE_HEIGHT;
            const pvh = Math.round(ph * PAGE_SCALE);

            // ── Background-image pages (uploaded images / PDF pages) ──────────
            // width=100% + height=auto preserves aspect ratio — no distortion,
            // no fixed height, separator appears flush below the image.
            if (page.backgroundImage) {
              const isActiveBgPage = idx === activePageIndex;
              return (
                <div
                  className="mx-auto shadow-lg relative bg-white"
                  style={{ width: PAGE_VISUAL_WIDTH }}
                  onMouseDown={() => {
                    if (!isReadOnly) onSetActivePage?.(idx);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.backgroundImage}
                    alt=""
                    draggable={false}
                    style={{
                      display: "block",
                      width: "100%",
                      height: "auto",
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  />

                  {/* Active-page highlight ring (matches normal page selection feel) */}
                  {isActiveBgPage && !isReadOnly && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ outline: "2px solid #3b82f6", outlineOffset: -2, zIndex: 10 }}
                    />
                  )}

                  {/* "Add element" button — always visible on the imported page when active or empty */}
                  {!isReadOnly && page.elements.length === 0 && (
                    <div className="absolute inset-x-0 top-0 flex justify-center pt-3 z-20">
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetActivePage?.(idx);
                          const rect = e.currentTarget.getBoundingClientRect();
                          onRequestAddElement?.(rect.left + rect.width / 2, rect.top);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 hover:bg-white text-gray-800 text-sm font-medium rounded-lg shadow transition-colors select-none border border-gray-200"
                      >
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1v13M1 7.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        Add element
                      </button>
                    </div>
                  )}

                  {/* Overlay elements (text boxes, signatures, etc.) scaled to PAGE_SCALE */}
                  {page.elements.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: PAGE_WIDTH,
                        height: ph,
                        transform: `scale(${PAGE_SCALE})`,
                        transformOrigin: "top left",
                        pointerEvents: isReadOnly ? "none" : "auto",
                      }}
                    >
                      <ProposalPage
                        page={page}
                        pageIndex={idx}
                        isActive={isActiveBgPage}
                        isReadOnly={isReadOnly}
                        pageHeight={ph}
                        transparent
                        selectedElementId={selectedElementId}
                        overflowedElementIds={overflowedElementIds}
                        onAddToNextPage={onAddToNextPage}
                        onSelectElement={(id) => { onSetActivePage?.(idx); onSelectElement(id); }}
                        onDeselect={onDeselectElement}
                        onMoveStart={handleMoveStart}
                        onResizeStart={handleResizeStart}
                        onAlignImage={onAlignImage}
                        onDuplicateElement={onDuplicateElement}
                        onDeleteElement={onDeleteElement}
                        onContentChange={onContentChange}
                        onCustomVarSync={onCustomVarSync}
                        onHeightChange={onHeightChange}
                        onInsertAfter={onInsertAfter}
                        onVariableNameChange={onVariableNameChange}
                        recipients={recipients}
                        onChangeQuote={onChangeQuote}
                        quoteDataMap={quoteDataMap}
                        onRequestAddElement={(x: number, y: number) => {
                          onSetActivePage?.(idx);
                          onRequestAddElement?.(x, y);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            }

            // ── Normal pages — keep the existing scale-transform approach ─────
            return (
              <div
                className="mx-auto overflow-visible"
                style={{ width: PAGE_VISUAL_WIDTH, height: pvh }}
              >
                <div
                  style={{
                    width: PAGE_WIDTH,
                    height: ph,
                    transform: `scale(${PAGE_SCALE})`,
                    transformOrigin: "top left",
                  }}
                >
                  <ProposalPage
                    page={page}
                    pageIndex={idx}
                    isActive={idx === activePageIndex}
                    isReadOnly={isReadOnly}
                    pageHeight={ph}
                    selectedElementId={selectedElementId}
                    overflowedElementIds={overflowedElementIds}
                    onAddToNextPage={onAddToNextPage}
                    onSelectElement={(id) => { onSetActivePage?.(idx); onSelectElement(id); }}
                    onDeselect={onDeselectElement}
                    onMoveStart={handleMoveStart}
                    onResizeStart={handleResizeStart}
                    onAlignImage={onAlignImage}
                    onDuplicateElement={onDuplicateElement}
                    onDeleteElement={onDeleteElement}
                    onContentChange={onContentChange}
                    onCustomVarSync={onCustomVarSync}
                    onHeightChange={onHeightChange}
                    onInsertAfter={onInsertAfter}
                    onVariableNameChange={onVariableNameChange}
                    recipients={recipients}
                    onChangeQuote={onChangeQuote}
                    quoteDataMap={quoteDataMap}
                    onRequestAddElement={(x: number, y: number) => {
                      onSetActivePage?.(idx);
                      onRequestAddElement?.(x, y);
                    }}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      ))}

      {/* Bottom gap in read-only mode */}
      {isReadOnly && <div className="h-4 bg-gray-100" />}

      {/* Bottom separator — no page label since there is no page below */}
      {!isReadOnly && pages.length > 0 && (
          <ProposalPageSeparator
            insertAtIndex={pages.length}
            managePageIndex={pages.length - 1}
            isBottom
            onInsertBlankPage={onInsertPage}
            onDuplicatePage={onDuplicatePage}
            onDeletePage={onDeletePage}
            onUploadFile={onUploadFile}
            onAddQuotePage={onAddQuotePage}
            managedPageQuoteId={pages[pages.length - 1]?.quoteId}
            onChangeQuotePage={onChangeQuotePage}
          />
      )}
    </div>
  );
}
