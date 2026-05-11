"use client";

import { useCallback, useRef, useState } from "react";
import {
  DEFAULT_ELEMENT_SIZES,
  DEFAULT_STYLES,
  ElementType,
  TemplateElement,
  TemplatePage,
  TEXT_ELEMENT_WIDTH,
} from "@/components/proposal-template/proposalTemplateTypes";

const HISTORY_LIMIT = 50;
const GRID_SIZE = 4;

// Page boundary constants — single source of truth for all clamping logic.
// Elements must always stay within this content zone.
const PAGE_HEIGHT = 1056;
const PAGE_TOP    = 32;   // header zone — no element may start above this
const PAGE_FLOOR  = PAGE_HEIGHT - 40; // footer zone — no element bottom may exceed this (1016)

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clonePages(pages: TemplatePage[]): TemplatePage[] {
  return JSON.parse(JSON.stringify(pages));
}

export function useProposalTemplate(initialPages: TemplatePage[] = []) {
  const [pages, setPages] = useState<TemplatePage[]>(
    initialPages.length > 0 ? initialPages : [{ id: generateId(), elements: [] }]
  );
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  const history = useRef<TemplatePage[][]>([]);
  const future = useRef<TemplatePage[][]>([]);

  const pushHistory = useCallback((snapshot: TemplatePage[]) => {
    history.current = [...history.current.slice(-HISTORY_LIMIT + 1), clonePages(snapshot)];
    future.current = [];
  }, []);

  const commitPages = useCallback(
    (updater: (prev: TemplatePage[]) => TemplatePage[]) => {
      setPages((prev) => {
        pushHistory(prev);
        return updater(prev);
      });
    },
    [pushHistory]
  );

  const undo = useCallback(() => {
    if (history.current.length === 0) return;
    setPages((prev) => {
      const snapshot = history.current.pop()!;
      future.current = [clonePages(prev), ...future.current.slice(0, HISTORY_LIMIT - 1)];
      return snapshot;
    });
    setSelectedElementId(null);
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setPages((prev) => {
      const snapshot = future.current.shift()!;
      history.current = [...history.current.slice(-HISTORY_LIMIT + 1), clonePages(prev)];
      return snapshot;
    });
    setSelectedElementId(null);
  }, []);

  const buildNewElement = (
    type: ElementType,
    x: number,
    y: number
  ): TemplateElement => {
    const size = DEFAULT_ELEMENT_SIZES[type];
    return {
      id: generateId(),
      type,
      x: snapToGrid(x),
      y: snapToGrid(y),
      w: type === "text" || type === "attachment" ? TEXT_ELEMENT_WIDTH : size.w,
      h: size.h,
      content: "",
      styles: { ...DEFAULT_STYLES },
    };
  };

  const addElement = useCallback(
    (type: ElementType, pageIndex: number = activePageIndex, initialContent: string = "") => {
      // Pre-generate the id so we can select it after the state update.
      const newElId = generateId();
      commitPages((prev) => {
        const page = prev[pageIndex];
        if (!page) return prev;
        // Compute y from the FRESH prev state — avoids stale-closure bugs
        // when updateElementHeight has reflowed elements since the last render.
        const lastBottom = page.elements.reduce(
          (max, el) => Math.max(max, el.y + el.h),
          32
        );
        const size = DEFAULT_ELEMENT_SIZES[type];
        // Clamp so the element bottom never exceeds PAGE_FLOOR, preventing PDF cut-off.
        const rawY = snapToGrid(lastBottom + 12);
        const clampedY = Math.min(rawY, Math.max(PAGE_TOP, PAGE_FLOOR - size.h));
        const newEl: TemplateElement = {
          id: newElId,
          type,
          x: snapToGrid(40),
          y: clampedY,
          w: type === "text" || type === "attachment" || type === "quote" ? TEXT_ELEMENT_WIDTH : size.w,
          h: size.h,
          content: initialContent,
          styles: { ...DEFAULT_STYLES },
        };
        const next = clonePages(prev);
        next[pageIndex].elements.push(newEl);
        return next;
      });
      setSelectedElementId(newElId);
      return newElId;
    },
    [activePageIndex, commitPages]
  );

  const insertElementAfter = useCallback(
    (afterId: string, type: ElementType, _pageIndexHint: number = activePageIndex, initialContent: string = "") => {
      const newElId = generateId();
      commitPages((prev) => {
        const next = clonePages(prev);

        // Find the page that actually owns afterId using fresh prev state.
        // Never trust the closure pageIndex — it can be stale after page operations.
        const targetPageIdx = next.findIndex((p) =>
          p.elements.some((e) => e.id === afterId)
        );
        // Fall back to the hinted page (or active page) if afterId isn't found anywhere.
        const page = targetPageIdx !== -1 ? next[targetPageIdx] : next[_pageIndexHint];
        if (!page) return prev;

        const idx = page.elements.findIndex((e) => e.id === afterId);
        const afterEl = idx !== -1 ? page.elements[idx] : null;
        const insertY = afterEl ? afterEl.y + afterEl.h + 8 : 60;
        const pushThreshold = afterEl ? afterEl.y + afterEl.h : insertY;

        const size = DEFAULT_ELEMENT_SIZES[type];
        // Clamp so the element bottom never exceeds PAGE_FLOOR, preventing PDF cut-off.
        const rawInsertY = snapToGrid(insertY);
        const clampedInsertY = Math.min(rawInsertY, Math.max(PAGE_TOP, PAGE_FLOOR - size.h));
        const newEl: TemplateElement = {
          id: newElId,
          type,
          x: snapToGrid(40),
          y: clampedInsertY,
          w: type === "text" || type === "attachment" || type === "quote" ? TEXT_ELEMENT_WIDTH : size.w,
          h: size.h,
          content: initialContent,
          styles: { ...DEFAULT_STYLES },
        };
        const pushDelta = newEl.h + 8;

        if (idx === -1) {
          page.elements.push(newEl);
        } else {
          for (let i = idx + 1; i < page.elements.length; i++) {
            if (page.elements[i].y >= pushThreshold) {
              page.elements[i] = {
                ...page.elements[i],
                y: page.elements[i].y + pushDelta,
              };
            }
          }
          page.elements.splice(idx + 1, 0, newEl);
        }
        return next;
      });
      setSelectedElementId(newElId);
      return newElId;
    },
    [activePageIndex, commitPages]
  );

  const moveElement = useCallback(
    (elementId: string, dx: number, dy: number, pageIndex: number = activePageIndex) => {
      setPages((prev) => {
        const page = prev[pageIndex];
        if (!page) return prev;
        const elIdx = page.elements.findIndex((e) => e.id === elementId);
        if (elIdx === -1) return prev;
        const el = page.elements[elIdx];
        const oldBottom = el.y + el.h;

        let newX = snapToGrid(Math.max(0, el.x + dx));
        let newY = snapToGrid(el.y + dy);

        // Clamp to the page content zone for every element type:
        // top must be at or below PAGE_TOP, bottom must not exceed PAGE_FLOOR.
        newY = Math.max(PAGE_TOP, newY);
        newY = Math.min(PAGE_FLOOR - el.h, newY);

        // Image-specific: also prevent rising above elements already above it.
        // The ceiling is the highest bottom-edge of any element above the image's current top.
        if (el.type === "image") {
          const ceiling = page.elements.reduce((max, e, i) => {
            if (i === elIdx) return max;
            return e.y + e.h <= el.y ? Math.max(max, e.y + e.h) : max;
          }, PAGE_TOP);
          newY = Math.max(ceiling, newY);
        }

        const newEl = { ...el, x: newX, y: newY };
        const newBottom = newY + el.h;
        const delta = newBottom - oldBottom;

        let newElements = [...page.elements];
        newElements[elIdx] = newEl;

        // Reflow: push / pull elements below an image as it moves vertically
        if (el.type === "image" && delta !== 0) {
          newElements = newElements.map((other, i) => {
            if (i === elIdx || other.y < oldBottom) return other;
            return { ...other, y: Math.max(0, other.y + delta) };
          });
        }

        const newPages = [...prev];
        newPages[pageIndex] = { ...page, elements: newElements };
        return newPages;
      });
    },
    [activePageIndex]
  );

  const commitMove = useCallback(
    (elementId: string, pageIndex: number = activePageIndex) => {
      setPages((prev) => {
        pushHistory(prev);
        return prev;
      });
    },
    [activePageIndex, pushHistory]
  );

  /** Live resize — shallow-clones only the affected element. Reflows elements below images. */
  const resizeElement = useCallback(
    (
      elementId: string,
      w: number,
      h: number,
      x: number,
      y: number,
      pageIndex: number = activePageIndex
    ) => {
      setPages((prev) => {
        const page = prev[pageIndex];
        if (!page) return prev;
        const elIdx = page.elements.findIndex((e) => e.id === elementId);
        if (elIdx === -1) return prev;
        const el = page.elements[elIdx];
        const oldBottom = el.y + el.h;

        // Clamp the top edge to the page content zone (applies to all element types).
        let clampedY = Math.max(PAGE_TOP, snapToGrid(y));

        // Image-specific: also prevent rising above elements already above it.
        if (el.type === "image") {
          const ceiling = page.elements.reduce((max, e, i) => {
            if (i === elIdx) return max;
            return e.y + e.h <= el.y ? Math.max(max, e.y + e.h) : max;
          }, PAGE_TOP);
          clampedY = Math.max(ceiling, clampedY);
        }

        // If y was clamped upward, shrink h so the bottom edge stays anchored.
        const yDiff = clampedY - Math.max(0, snapToGrid(y));
        // Also clamp h so the element bottom never exceeds PAGE_FLOOR.
        const rawH = Math.max(40, snapToGrid(h) - yDiff);
        const clampedH = Math.min(rawH, PAGE_FLOOR - clampedY);
        const newEl = {
          ...el,
          w: Math.max(40, snapToGrid(w)),
          h: Math.max(40, clampedH),
          x: Math.max(0, snapToGrid(x)),
          y: clampedY,
        };
        const newBottom = newEl.y + newEl.h;
        const delta = newBottom - oldBottom;

        let newElements = [...page.elements];
        newElements[elIdx] = newEl;

        // Reflow: push / pull elements below an image when its bottom edge changes.
        // Top-corner resizes keep the bottom edge fixed (delta ≈ 0) so nothing shifts.
        if (el.type === "image" && Math.abs(delta) > 0.5) {
          newElements = newElements.map((other, i) => {
            if (i === elIdx || other.y < oldBottom) return other;
            return { ...other, y: Math.max(0, other.y + delta) };
          });
        }

        const newPages = [...prev];
        newPages[pageIndex] = { ...page, elements: newElements };
        return newPages;
      });
    },
    [activePageIndex]
  );

  const commitResize = useCallback(
    (_elementId: string, _pageIndex: number = activePageIndex) => {
      setPages((prev) => {
        pushHistory(prev);
        return prev;
      });
    },
    [activePageIndex, pushHistory]
  );

  const updateElementContent = useCallback(
    (elementId: string, content: string, pageIndex: number = activePageIndex) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        // Try the hinted page first; fall back to searching all pages.
        // Protects against a stale activePageIndex after page duplication / navigation.
        let el = next[pageIndex]?.elements.find((e) => e.id === elementId);
        if (!el) {
          for (const page of next) {
            el = page.elements.find((e) => e.id === elementId);
            if (el) break;
          }
        }
        if (!el) return prev;
        el.content = content;
        return next;
      });
    },
    [activePageIndex, commitPages]
  );

  const updateElementStyles = useCallback(
    (
      elementId: string,
      styles: Partial<TemplateElement["styles"]>,
      pageIndex: number = activePageIndex
    ) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        // Try the hinted page first, then search all pages (guards against stale activePageIndex).
        let el = next[pageIndex]?.elements.find((e) => e.id === elementId);
        if (!el) {
          for (const page of next) {
            el = page.elements.find((e) => e.id === elementId);
            if (el) break;
          }
        }
        if (!el) return prev;
        el.styles = { ...el.styles, ...styles };
        return next;
      });
    },
    [activePageIndex, commitPages]
  );

  // Updates height only — does NOT push to undo history (auto-resize is implicit).
  // Also reflows elements below the growing/shrinking text box, just like image reflow.
  const updateElementHeight = useCallback(
    (elementId: string, height: number, pageIndex: number = activePageIndex) => {
      setPages((prev) => {
        // Try the hinted page first, then search all pages.
        // Guards against a stale activePageIndex after page duplication / navigation.
        let targetPageIndex = pageIndex;
        let page = prev[pageIndex];
        let elIdx = page?.elements.findIndex((e) => e.id === elementId) ?? -1;

        if (elIdx === -1) {
          for (let i = 0; i < prev.length; i++) {
            const idx = prev[i].elements.findIndex((e) => e.id === elementId);
            if (idx !== -1) {
              targetPageIndex = i;
              page = prev[i];
              elIdx = idx;
              break;
            }
          }
        }

        if (!page || elIdx === -1) return prev;

        const el = page.elements[elIdx];
        const oldH = el.h;
        const newH = Math.max(40, snapToGrid(height));
        const delta = newH - oldH;

        // Shallow-clone only affected objects for performance (avoids deep-cloning large images)
        const newElements = page.elements.map((other, i) => {
          if (i === elIdx) return { ...other, h: newH };
          // Push elements whose top sits at or below the old bottom edge of this element
          if (delta !== 0 && other.y >= el.y + oldH) {
            return { ...other, y: Math.max(0, other.y + delta) };
          }
          return other;
        });

        const newPages = [...prev];
        newPages[targetPageIndex] = { ...page, elements: newElements };
        return newPages;
      });
    },
    [activePageIndex]
  );

  const updateElementVariableName = useCallback(
    (elementId: string, variableName: string, pageIndex: number = activePageIndex) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        // Try the hinted page first; fall back to searching all pages.
        let el = next[pageIndex]?.elements.find((e) => e.id === elementId);
        if (!el) {
          for (const page of next) {
            el = page.elements.find((e) => e.id === elementId);
            if (el) break;
          }
        }
        if (!el) return prev;
        el.variableName = variableName;
        return next;
      });
    },
    [activePageIndex, commitPages]
  );

  /**
   * Updates the content of every `custom_variable` element whose `variableName`
   * matches the given key, across all pages. This makes custom variables
   * document-scoped: typing a value in one field syncs it everywhere in the doc.
   */
  const syncCustomVarContentByName = useCallback(
    (variableName: string, content: string) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        let changed = false;
        for (const page of next) {
          for (const el of page.elements) {
            if (el.type === "custom_variable" && el.variableName === variableName) {
              el.content = content;
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    },
    [commitPages]
  );

  const duplicateElement = useCallback(
    (elementId: string, pageIndex: number = activePageIndex) => {
      const id = generateId();
      commitPages((prev) => {
        const next = clonePages(prev);
        // Try the hinted page first; fall back to searching all pages.
        let targetPageIndex = pageIndex;
        let el = next[pageIndex]?.elements.find((e) => e.id === elementId);
        if (!el) {
          for (let i = 0; i < next.length; i++) {
            el = next[i].elements.find((e) => e.id === elementId);
            if (el) { targetPageIndex = i; break; }
          }
        }
        if (!el) return prev;
        const copy: TemplateElement = {
          ...JSON.parse(JSON.stringify(el)),
          id,
          x: snapToGrid(el.x + GRID_SIZE * 4),
          y: snapToGrid(el.y + GRID_SIZE * 4),
        };
        next[targetPageIndex].elements.push(copy);
        return next;
      });
      setSelectedElementId(id);
    },
    [activePageIndex, commitPages]
  );

  const deleteElement = useCallback(
    (elementId: string, pageIndex: number = activePageIndex) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        // Try the hinted page first; fall back to searching all pages.
        // Guards against a stale activePageIndex when the element lives on a different page.
        let targetPageIndex = pageIndex;
        if (!next[pageIndex]?.elements.some((e) => e.id === elementId)) {
          for (let i = 0; i < next.length; i++) {
            if (next[i].elements.some((e) => e.id === elementId)) {
              targetPageIndex = i;
              break;
            }
          }
        }
        next[targetPageIndex].elements = next[targetPageIndex].elements.filter(
          (e) => e.id !== elementId
        );
        return next;
      });
      setSelectedElementId(null);
    },
    [activePageIndex, commitPages]
  );

  const addPage = useCallback(() => {
    let newIdx = 0;
    commitPages((prev) => {
      const next = [...clonePages(prev), { id: generateId(), elements: [] }];
      newIdx = next.length - 1;
      return next;
    });
    // Call outside commitPages so React applies it as a clean, separate state update
    setActivePageIndex((prev) => (newIdx > 0 ? newIdx : prev));
  }, [commitPages]);

  /**
   * Adds a text element to the page after `fromPageIndex`, creating that page if it
   * doesn't exist yet. Navigates there so the user can keep typing.
   */
  const addTextToNextPage = useCallback(
    (fromPageIndex: number, styles: TemplateElement["styles"]) => {
      const targetIdx = fromPageIndex + 1;
      commitPages((prev) => {
        const next = clonePages(prev);

        if (targetIdx >= next.length) {
          next.push({ id: generateId(), elements: [] });
        }

        const newEl: TemplateElement = {
          id: generateId(),
          type: "text",
          x: 40,
          y: 32,
          w: TEXT_ELEMENT_WIDTH,
          h: 40,
          content: "",
          styles: { ...styles },
        };

        const pushDelta = newEl.h + 8;
        next[targetIdx].elements = next[targetIdx].elements.map((el) => ({
          ...el,
          y: el.y + pushDelta,
        }));
        next[targetIdx].elements.unshift(newEl);
        return next;
      });
      // Navigate outside the updater so React applies it reliably
      setActivePageIndex(targetIdx);
    },
    [commitPages]
  );

  const insertPageAt = useCallback(
    (index: number) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        next.splice(index, 0, { id: generateId(), elements: [] });
        return next;
      });
      setActivePageIndex(index);
      setSelectedElementId(null);
    },
    [commitPages]
  );

  const duplicatePage = useCallback(
    (pageIndex: number) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        const copy = JSON.parse(JSON.stringify(next[pageIndex]));
        copy.id = generateId();
        copy.elements = copy.elements.map((el: TemplateElement) => ({
          ...el,
          id: generateId(),
        }));
        next.splice(pageIndex + 1, 0, copy);
        return next;
      });
      // Navigate outside the updater — keeps the setPages callback pure
      // and guarantees React applies activePageIndex reliably before the next action
      setActivePageIndex(pageIndex + 1);
      setSelectedElementId(null);
    },
    [commitPages]
  );

  const deletePage = useCallback(
    (pageIndex: number) => {
      let nextLength = 0;
      commitPages((prev) => {
        if (prev.length <= 1) {
          nextLength = 1;
          return [{ id: generateId(), elements: [] }];
        }
        const next = clonePages(prev);
        next.splice(pageIndex, 1);
        nextLength = next.length;
        return next;
      });
      // Move setActivePageIndex outside the updater so it's a clean state update
      setActivePageIndex((p) => Math.max(0, Math.min(p, Math.max(0, nextLength - 1))));
      setSelectedElementId(null);
    },
    [commitPages]
  );

  /**
   * Inserts one or more pages with background images at the given index.
   * Used for file uploads (images and PDF pages converted to PNGs).
   */
  const insertPagesWithBackground = useCallback(
    (atIndex: number, backgroundUrls: string[], pageHeights?: number[]) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        const newPages = backgroundUrls.map((url, i) => ({
          id: generateId(),
          elements: [] as TemplateElement[],
          backgroundImage: url,
          ...(pageHeights?.[i] !== undefined ? { pageHeight: pageHeights[i] } : {}),
        }));
        next.splice(atIndex, 0, ...newPages);
        return next;
      });
      setActivePageIndex(atIndex);
      setSelectedElementId(null);
    },
    [commitPages]
  );

  /**
   * Inserts one or more quote-PDF pages (rendered to PNG) at the given index.
   * Like insertPagesWithBackground but also stores quoteId/quoteName/quoteNumber
   * so the page separator can offer "Change Quote" / "Refresh" later.
   */
  const insertQuotePages = useCallback(
    (
      atIndex: number,
      backgroundUrls: string[],
      pageHeights: number[],
      quoteId: string,
      quoteName: string,
      quoteNumber: string
    ) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        const newPages = backgroundUrls.map((url, i) => ({
          id: generateId(),
          elements: [] as TemplateElement[],
          backgroundImage: url,
          pageHeight: pageHeights[i],
          quoteId,
          quoteName,
          quoteNumber,
        }));
        next.splice(atIndex, 0, ...newPages);
        return next;
      });
      setActivePageIndex(atIndex);
      setSelectedElementId(null);
    },
    [commitPages]
  );

  /**
   * Replaces all consecutive pages that share a given quoteId (starting from
   * startIndex) with new background-image pages generated from the quote PDF.
   * Used by "Change Quote" / "Refresh Quote" in the page separator menu.
   */
  const replaceQuotePages = useCallback(
    (
      startIndex: number,
      oldQuoteId: string,
      backgroundUrls: string[],
      pageHeights: number[],
      newQuoteId: string,
      newQuoteName: string,
      newQuoteNumber: string
    ) => {
      commitPages((prev) => {
        const next = clonePages(prev);
        // Find how many consecutive pages share the old quoteId from startIndex
        let count = 0;
        for (let i = startIndex; i < next.length; i++) {
          if (next[i].quoteId === oldQuoteId) count++;
          else break;
        }
        const newPages = backgroundUrls.map((url, i) => ({
          id: generateId(),
          elements: [] as TemplateElement[],
          backgroundImage: url,
          pageHeight: pageHeights[i],
          quoteId: newQuoteId,
          quoteName: newQuoteName,
          quoteNumber: newQuoteNumber,
        }));
        next.splice(startIndex, count, ...newPages);
        return next;
      });
      setActivePageIndex(startIndex);
      setSelectedElementId(null);
    },
    [commitPages]
  );

  const canUndo = history.current.length > 0;
  const canRedo = future.current.length > 0;

  const selectedElement = (() => {
    if (!selectedElementId) return null;
    for (const page of pages) {
      const found = page.elements.find((e) => e.id === selectedElementId);
      if (found) return found;
    }
    return null;
  })();

  const resetPages = useCallback((incoming: TemplatePage[]) => {
    setPages(incoming.length > 0 ? incoming : [{ id: generateId(), elements: [] }]);
    history.current = [];
    future.current = [];
    setSelectedElementId(null);
    setActivePageIndex(0);
  }, []);

  return {
    pages,
    activePageIndex,
    setActivePageIndex,
    selectedElementId,
    setSelectedElementId,
    selectedElement,
    canUndo,
    canRedo,
    undo,
    redo,
    addElement,
    insertElementAfter,
    updateElementHeight,
    insertPageAt,
    duplicatePage,
    deletePage,
    moveElement,
    commitMove,
    resizeElement,
    commitResize,
    updateElementContent,
    updateElementStyles,
    updateElementVariableName,
    syncCustomVarContentByName,
    duplicateElement,
    deleteElement,
    addPage,
    addTextToNextPage,
    insertPagesWithBackground,
    insertQuotePages,
    replaceQuotePages,
    resetPages,
  };
}
