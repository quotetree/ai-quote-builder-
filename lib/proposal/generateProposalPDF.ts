import type { TemplatePage } from "@/components/proposal-template/proposalTemplateTypes";

/** Letter page dimensions in PDF points (1pt = 1/72 inch). */
const PDF_W = 612;
/** Canvas unscaled width. Scale factor: PDF_W / CANVAS_W = 0.75 */
const CANVAS_W = 816;
const CANVAS_H = 1056;
const SCALE = PDF_W / CANVAS_W; // ≈ 0.75

/**
 * Fetches a URL and returns a base64 data-URL, or null on failure.
 * Uses no-cors fallback — works with Supabase public storage.
 */
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Detect image format from data URL or URL path. */
function imageFormat(src: string): "PNG" | "JPEG" | "WEBP" {
  const lower = src.toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return "JPEG";
  if (lower.includes("webp")) return "WEBP";
  return "PNG";
}

/**
 * Converts HTML (from contentEditable text elements) to plain text,
 * preserving line breaks and bullet-list markers.
 */
function htmlToText(html: string): string {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;

  // Insert newline after block elements
  div.querySelectorAll("p, div, br").forEach((el) => {
    el.insertAdjacentText("afterend", "\n");
  });

  // Prefix list items with bullet / number placeholders
  div.querySelectorAll("li").forEach((li, idx) => {
    const ol = li.closest("ol");
    const prefix = ol ? `${idx + 1}. ` : "• ";
    li.insertAdjacentText("beforebegin", prefix);
    li.insertAdjacentText("afterend", "\n");
  });

  return (div.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Parse "#rrggbb" or "#rgb" hex color to [r, g, b] (0-255).
 * Falls back to black on invalid input.
 */
function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex ?? "#000000").replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.padEnd(6, "0");
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/**
 * Generates and triggers download of a PDF for the given proposal pages.
 * @param pages   The TemplatePage[] state from useProposalTemplate.
 * @param filename  Desired PDF filename (without extension).
 */
export async function generateProposalPDF(
  pages: TemplatePage[],
  filename = "proposal"
): Promise<void> {
  if (pages.length === 0) throw new Error("No pages to export.");

  const { default: jsPDF } = await import("jspdf");

  const firstPageH = Math.round((pages[0].pageHeight ?? CANVAS_H) * SCALE);
  const doc = new jsPDF({ unit: "pt", format: [PDF_W, firstPageH], orientation: "portrait" });

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageH = Math.round((page.pageHeight ?? CANVAS_H) * SCALE);

    if (pageIdx > 0) {
      doc.addPage([PDF_W, pageH]);
    }

    // ── Background image (uploaded image / PDF-page PNG) ──────────────
    if (page.backgroundImage) {
      const dataUrl = await toDataUrl(page.backgroundImage);
      if (dataUrl) {
        doc.addImage(dataUrl, imageFormat(page.backgroundImage), 0, 0, PDF_W, pageH);
      }
    } else {
      // White background for blank pages
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, PDF_W, pageH, "F");
    }

    // ── Overlay elements ──────────────────────────────────────────────
    for (const el of page.elements) {
      const x = el.x * SCALE;
      const y = el.y * SCALE;
      const w = el.w * SCALE;
      const h = el.h * SCALE;

      switch (el.type) {
        case "text": {
          const text = htmlToText(el.content);
          if (!text) continue;

          const fontFamily = el.styles.fontFamily?.toLowerCase().includes("times")
            ? "times"
            : "helvetica";
          const fontStyle =
            el.styles.bold && el.styles.italic ? "bolditalic"
              : el.styles.bold ? "bold"
              : el.styles.italic ? "italic"
              : "normal";

          doc.setFont(fontFamily, fontStyle);
          const ptSize = el.styles.fontSize * SCALE;
          doc.setFontSize(ptSize);

          const [r, g, b] = hexToRgb(el.styles.color ?? "#000000");
          doc.setTextColor(r, g, b);

          const lineH = ptSize * 1.2;
          const textX =
            el.styles.align === "center" ? x + w / 2
            : el.styles.align === "right" ? x + w
            : x;

          const lines = doc.splitTextToSize(text, w);
          doc.text(lines, textX, y + ptSize, {
            align: el.styles.align ?? "left",
            lineHeightFactor: 1.2,
            maxWidth: w,
          });
          break;
        }

        case "custom_variable": {
          // Prefer the filled value; fall back to the placeholder token if empty.
          const label = el.content || (el.variableName ? `{{${el.variableName}}}` : "");
          if (!label) continue;

          doc.setFont("helvetica", "normal");
          const ptSize = (el.styles.fontSize ?? 14) * SCALE;
          doc.setFontSize(ptSize);
          doc.setTextColor(80, 80, 80);

          const textX =
            el.styles.align === "center" ? x + w / 2
            : el.styles.align === "right" ? x + w
            : x;

          doc.text(label, textX, y + ptSize, { align: el.styles.align ?? "left", maxWidth: w });
          break;
        }

        case "image": {
          if (!el.content) continue;
          // Image content is stored as a base64 data URL — use it directly.
          // Only fetch via toDataUrl if it's a remote URL (e.g. Supabase Storage).
          const dataUrl = el.content.startsWith("data:")
            ? el.content
            : await toDataUrl(el.content);
          if (dataUrl) {
            doc.addImage(dataUrl, imageFormat(el.content), x, y, w, h);
          }
          break;
        }

        case "signature":
        case "initial": {
          // Render a labelled placeholder box
          doc.setDrawColor(150, 150, 150);
          doc.setFillColor(248, 248, 248);
          doc.roundedRect(x, y, w, h, 3, 3, "FD");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(120, 120, 120);
          const label = el.type === "signature" ? "Signature" : "Initial";
          doc.text(label, x + w / 2, y + h / 2 + 3, { align: "center" });
          break;
        }

        case "checkbox": {
          doc.setDrawColor(100, 100, 100);
          doc.setFillColor(255, 255, 255);
          doc.rect(x, y, w, h, "FD");
          break;
        }

        case "date": {
          const dateText = el.content ? htmlToText(el.content) : "Date";
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.setTextColor(60, 60, 60);
          doc.text(dateText || "Date", x, y + 10 * SCALE);
          // Underline
          doc.setDrawColor(150, 150, 150);
          doc.line(x, y + h, x + w, y + h);
          break;
        }

        case "attachment": {
          const attachText = htmlToText(el.content) || "Attachment";
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          doc.setDrawColor(200, 200, 200);
          doc.setFillColor(250, 250, 250);
          doc.roundedRect(x, y, w, h, 2, 2, "FD");
          doc.text(attachText, x + 6, y + h / 2 + 3);
          break;
        }

        default:
          break;
      }
    }
  }

  doc.save(`${filename}.pdf`);
}
