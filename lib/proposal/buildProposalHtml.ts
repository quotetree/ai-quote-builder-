/**
 * Server-side proposal HTML builder.
 *
 * Generates a self-contained HTML document from proposal page data so it can
 * be passed DIRECTLY to PDFShift as a raw `source` string.  This avoids the
 * need for PDFShift to fetch a URL (which requires a publicly reachable server
 * and therefore does not work reliably in local/ngrok development environments).
 *
 * All background images are fetched server-side, downscaled with sharp to keep
 * the HTML payload under PDFShift's request-size limits, and embedded as
 * base64 data URIs so the resulting HTML has zero external dependencies.
 */

import sharp from "sharp";
import type { TemplatePage, TemplateElement } from "@/components/proposal-template/proposalTemplateTypes";

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

// ---------------------------------------------------------------------------
// Image optimization
// ---------------------------------------------------------------------------

// Background pages are rendered at exactly the canvas size (816 × 1056).
// Providing more pixels than that only inflates the payload with no visible
// quality benefit in the final PDF.
const MAX_BG_WIDTH = 816;
const MAX_BG_HEIGHT = 1056;

// Inline element images rarely need more than this. We allow slightly more
// to accommodate images that span most of a page.
const MAX_ELEMENT_DIMENSION = 1200;

// Only run sharp on images that are actually large enough to be worth
// processing. Tiny images (icons, logos) stay untouched.
const OPTIMIZE_THRESHOLD_BYTES = 200_000; // 200 KB

/**
 * Downscales and converts a raw image buffer to JPEG using sharp.
 * Falls back to the original buffer + reported MIME if sharp fails.
 *
 * @param rawBuf       Raw bytes fetched from the remote URL
 * @param originalMime Content-Type header value from the response
 * @param isBackground True when the image will be used as a page background
 */
async function optimizeImage(
  rawBuf: ArrayBuffer,
  originalMime: string,
  isBackground: boolean
): Promise<{ buf: Buffer; mime: string }> {
  const input = Buffer.from(rawBuf);

  if (input.byteLength < OPTIMIZE_THRESHOLD_BYTES) {
    // Already small enough — no processing needed.
    return { buf: input, mime: originalMime };
  }

  try {
    const img = sharp(input);
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;

    let pipeline = sharp(input);

    if (isBackground) {
      if (w > MAX_BG_WIDTH || h > MAX_BG_HEIGHT) {
        pipeline = pipeline.resize(MAX_BG_WIDTH, MAX_BG_HEIGHT, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
    } else {
      const maxDim = Math.max(w, h);
      if (maxDim > MAX_ELEMENT_DIMENSION) {
        pipeline = pipeline.resize(MAX_ELEMENT_DIMENSION, MAX_ELEMENT_DIMENSION, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
    }

    const optimized = await pipeline.jpeg({ quality: 85, mozjpeg: false }).toBuffer();

    console.log(
      `[buildHtml] optimized  ${Math.round(input.byteLength / 1024)}KB → ${Math.round(optimized.byteLength / 1024)}KB  ` +
      `(${w}×${h} → JPEG85, ${isBackground ? "bg" : "el"})`
    );

    return { buf: optimized, mime: "image/jpeg" };
  } catch (err) {
    console.warn(
      `[buildHtml] optimize failed, using original — ${err instanceof Error ? err.message : err}`
    );
    return { buf: input, mime: originalMime };
  }
}

// ---------------------------------------------------------------------------
// Image pre-fetch
// ---------------------------------------------------------------------------

/**
 * Fetches every unique image URL referenced by the proposal pages, downscales
 * large images with sharp, and returns a map of original URL → base64 data URI.
 *
 * URLs that fail to fetch are omitted; callers fall back to the original URL.
 */
export async function prefetchProposalImages(
  pages: TemplatePage[]
): Promise<Record<string, string>> {
  // Track which URLs are used as page backgrounds vs. inline image elements
  // so we can apply the correct max-dimension constraint.
  const bgUrls = new Set<string>();
  const elementUrls = new Set<string>();

  for (const page of pages) {
    if (page.backgroundImage) bgUrls.add(page.backgroundImage);

    for (const el of page.elements) {
      if (el.type === "image" && el.content && !el.content.startsWith("data:")) {
        elementUrls.add(el.content);
      }
    }
  }

  // Merge into a single map: url → isBackground.
  // A URL used as a background takes the background sizing strategy even if it
  // also appears as an element image on another page.
  const allUrls = new Map<string, boolean>();
  for (const url of bgUrls) allUrls.set(url, true);
  for (const url of elementUrls) {
    if (!allUrls.has(url)) allUrls.set(url, false);
  }

  const result: Record<string, string> = {};

  await Promise.all(
    Array.from(allUrls.entries()).map(async ([url, isBackground]) => {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        });

        if (!res.ok) {
          console.warn(`[buildHtml] prefetch HTTP ${res.status}  ${url.slice(0, 80)}`);
          return;
        }

        const rawBuf = await res.arrayBuffer();
        const originalMime = res.headers.get("content-type") ?? "image/png";

        console.log(
          `[buildHtml] fetched  ${Math.round(rawBuf.byteLength / 1024)}KB  ${url.slice(0, 80)}`
        );

        const { buf, mime } = await optimizeImage(rawBuf, originalMime, isBackground);

        result[url] = `data:${mime};base64,${buf.toString("base64")}`;
      } catch (err) {
        console.warn(
          `[buildHtml] prefetch failed  ${url.slice(0, 80)} — ${err instanceof Error ? err.message : err}`
        );
      }
    })
  );

  console.log(
    `[buildHtml] prefetch complete — fetched=${Object.keys(result).length}  requested=${allUrls.size}`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Per-element HTML
// ---------------------------------------------------------------------------

function renderElement(el: TemplateElement, imgMap: Record<string, string>): string {
  const baseStyle =
    `position:absolute;` +
    `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;` +
    `box-sizing:border-box;overflow:hidden;`;

  switch (el.type) {
    case "text":
    case "custom_variable": {
      const fs = el.styles?.fontSize ?? 14;
      const color = el.styles?.color ?? "#000000";
      const fw = el.styles?.bold ? "bold" : "normal";
      const fst = el.styles?.italic ? "italic" : "normal";
      const td = el.styles?.underline ? "underline" : "none";
      const ta = el.styles?.align ?? "left";
      const ff = el.styles?.fontFamily?.toLowerCase().includes("times")
        ? "'Times New Roman',serif"
        : "Helvetica,Arial,sans-serif";
      const style =
        `${baseStyle}` +
        `font-size:${fs}px;color:${color};font-weight:${fw};` +
        `font-style:${fst};text-decoration:${td};text-align:${ta};` +
        `font-family:${ff};line-height:1.4;`;
      // el.content is HTML from contentEditable — safe to embed directly since
      // it was produced by the user's own proposal editor.
      const content = el.content ?? (el.type === "custom_variable" && el.variableName
        ? `{{${el.variableName}}}`
        : "");
      return `<div style="${style}">${content}</div>`;
    }

    case "image": {
      if (!el.content) return "";
      const src = el.content.startsWith("data:")
        ? el.content
        : (imgMap[el.content] ?? el.content);
      return `<img src="${src}" style="${baseStyle}object-fit:contain;" alt="" />`;
    }

    case "signature":
    case "initial": {
      // If the field has been filled (executed), burn the value into the PDF.
      // Empty fields are left out — Firma will place an interactive field there.
      if (!el.content) return "";
      if (el.content.startsWith("data:")) {
        return `<img src="${el.content}" style="${baseStyle}object-fit:contain;padding:2px;" alt="" />`;
      }
      if (el.content.startsWith("type:")) {
        const text = el.content.slice(5).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const fontSize = Math.min(el.h * 0.40, 28);
        return (
          `<div style="${baseStyle}display:flex;align-items:center;justify-content:center;` +
          `font-family:'Brush Script MT',cursive;font-size:${fontSize}px;` +
          `color:#111;text-align:center;overflow:visible;">` +
          `${text}</div>`
        );
      }
      return "";
    }

    case "date": {
      if (!el.content) return "";
      try {
        const d = new Date(el.content + "T12:00:00");
        const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const fs = el.styles?.fontSize ?? 12;
        return (
          `<div style="${baseStyle}display:flex;align-items:center;padding:0 8px;` +
          `font-family:Helvetica,Arial,sans-serif;font-size:${fs}px;color:#111;">` +
          `${formatted}</div>`
        );
      } catch {
        return "";
      }
    }

    case "checkbox": {
      // Only burn in the checkmark — unchecked boxes are left blank in the PDF.
      if (el.content !== "checked") return "";
      const size = Math.round(Math.min(el.w, el.h) * 0.55);
      return (
        `<div style="${baseStyle}display:flex;align-items:center;justify-content:center;">` +
        `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
        `xmlns="http://www.w3.org/2000/svg">` +
        `<path d="M5 13l4 4L19 7" stroke="#111111" stroke-width="3" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>` +
        `</svg></div>`
      );
    }

    case "attachment": {
      const text = (el.content ?? "Attachment").replace(/<[^>]*>/g, "");
      return (
        `<div style="${baseStyle}` +
        `border:1px solid #ddd;border-radius:2px;background:#fafafa;` +
        `font-size:9px;color:#666;font-family:Helvetica,Arial,sans-serif;` +
        `display:flex;align-items:center;padding:0 6px;">` +
        `${text}</div>`
      );
    }

    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Full HTML document
// ---------------------------------------------------------------------------

/**
 * Builds a complete self-contained HTML document for all proposal pages.
 *
 * @param pages        The TemplatePage[] from quote_proposals.pages
 * @param imgMap       Map of remote URL → base64 data URI (from prefetchProposalImages)
 */
export function buildProposalHtml(
  pages: TemplatePage[],
  imgMap: Record<string, string>
): string {
  const pageBlocks = pages.map((page) => {
    const pageH = page.pageHeight ?? PAGE_HEIGHT;
    const bgSrc = page.backgroundImage
      ? (imgMap[page.backgroundImage] ?? page.backgroundImage)
      : null;

    let inner = "";

    if (bgSrc) {
      inner += (
        `<img src="${bgSrc}" alt="" ` +
        `style="display:block;width:${PAGE_WIDTH}px;height:${pageH}px;object-fit:fill;" />`
      );
    }

    for (const el of page.elements) {
      inner += renderElement(el, imgMap);
    }

    return (
      `<div style="` +
      `width:${PAGE_WIDTH}px;height:${pageH}px;` +
      `position:relative;background:white;` +
      `page-break-after:always;break-after:page;` +
      `overflow:hidden;">` +
      inner +
      `</div>`
    );
  });

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<style>`,
    // Reset
    `*{box-sizing:border-box;margin:0;padding:0;}`,
    // Print page dimensions — match US Letter at 96 dpi
    `@page{size:${PAGE_WIDTH}px ${PAGE_HEIGHT}px;margin:0;}`,
    `html,body{margin:0;padding:0;width:${PAGE_WIDTH}px;background:#f3f4f6;}`,
    `</style>`,
    `</head>`,
    `<body>`,
    ...pageBlocks,
    `</body>`,
    `</html>`,
  ].join("\n");
}
