"use client";

/**
 * ProposalExportRenderer
 *
 * A dedicated, clean document renderer used ONLY for PDF export.
 * It is completely separate from the interactive editor UI:
 *   - No selection borders, resize handles, or add-element buttons
 *   - No CSS transform / scale / zoom
 *   - No scroll container clipping
 *   - No editor chrome of any kind
 *
 * Rendered via React portal directly into document.body so it is never
 * clipped by the editor's overflow:hidden container or affected by any
 * ancestor transform.
 *
 * Each page wrapper receives data-export-page="true" and an explicit
 * data-export-index attribute so the download handler can find and
 * validate each node independently.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TemplatePage } from "./proposalTemplateTypes";
import ProposalPage, { PAGE_HEIGHT, PAGE_WIDTH } from "./ProposalPage";
import { QuoteWithProfile } from "./QuoteBlock";

interface ProposalExportRendererProps {
  pages: TemplatePage[];
  /** Called whenever a page wrapper mounts/unmounts so the parent can track refs. */
  onPageRef: (index: number, el: HTMLDivElement | null) => void;
  /** Pre-fetched quote data for any quote elements in the proposal */
  quoteDataMap?: Record<string, QuoteWithProfile>;
}

export default function ProposalExportRenderer({
  pages,
  onPageRef,
  quoteDataMap,
}: ProposalExportRendererProps) {
  // createPortal needs the browser DOM — skip during SSR
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);
  if (!mounted) return null;

  const content = (
    <div
      aria-hidden="true"
      style={{
        // Idle off-screen position — only exists to populate hiddenPageRefs so
        // the EXPORT DEBUG panel can read node dimensions.  PDF capture uses its
        // own createRoot temp container at left:0 top:0 z-index:-1 (see modal).
        position: "fixed",
        left: "-1200px",
        top: 0,
        zIndex: -9999,
        pointerEvents: "none",
      }}
    >
      {pages.map((page, idx) => (
        <div
          key={page.id}
          ref={(el) => onPageRef(idx, el)}
          data-export-page="true"
          data-export-index={idx}
          style={{
            width: PAGE_WIDTH,
            background: "#ffffff",
            position: "relative",
            // minHeight ensures every page is at least a full US Letter page tall
            // (1056px). Background-image pages whose image is shorter than that
            // (e.g. a 101px banner or a 631px map) are padded with white space
            // below the image so the PDF always produces standard-size pages.
            // Regular pages: ProposalPage supplies its own explicit height via its
            // style prop, so minHeight has no effect on them.
            minHeight: PAGE_HEIGHT,
          }}
        >
          {page.backgroundImage ? (
            <>
              {/*
                Background image — width:100% height:auto so the browser
                sets the height from the image's natural aspect ratio.
                This matches the ProposalCanvas preview exactly and never
                stretches or crops the image.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.backgroundImage}
                alt=""
                draggable={false}
                crossOrigin="anonymous"
                style={{
                  display: "block",
                  width: "100%",
                  height: "auto",
                  userSelect: "none",
                }}
              />

              {/* Overlay elements rendered at unscaled coordinates on top */}
              {page.elements.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: PAGE_WIDTH,
                    height: page.pageHeight ?? PAGE_HEIGHT,
                    pointerEvents: "none",
                  }}
                >
                  <ProposalPage
                    page={page}
                    pageIndex={idx}
                    isActive={false}
                    isReadOnly
                    pageHeight={page.pageHeight}
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
            /*
              Regular / PDF-imported page.
              ProposalPage renders at PAGE_WIDTH × (page.pageHeight ?? PAGE_HEIGHT)
              with no shadow and no editor chrome.
            */
            <ProposalPage
              page={page}
              pageIndex={idx}
              isActive={false}
              isReadOnly
              pageHeight={page.pageHeight}
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
      ))}
    </div>
  );

  return createPortal(content, document.body);
}
