import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Legacy price-book quote builder chat (retired in AI Chat Upgrade Phase 8).
 * Use Project workspace → Chat rail → Scope or Plan modes instead.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Legacy price-book chat has been retired. Open your project, use the Chat panel, and choose Scope or Plan mode.",
      code: "LEGACY_CHAT_RETIRED",
    },
    { status: 410 },
  );
}
