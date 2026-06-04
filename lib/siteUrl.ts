import type { NextRequest } from "next/server";

/**
 * Public base URL for server-side fetches (e.g. PDFShift proposal export).
 * PDFShift must reach this host from the internet — not localhost.
 */
export function getPublicSiteUrl(req?: NextRequest): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  if (req) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) {
      const proto =
        req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
      return `${proto}://${host.split(",")[0].trim()}`.replace(/\/$/, "");
    }
  }

  const vercel = process.env.VERCEL_URL?.replace(/\/$/, "");
  if (vercel) return `https://${vercel}`;

  return null;
}
