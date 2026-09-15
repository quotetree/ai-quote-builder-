import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { QuoteExportUsage } from "@/lib/entitlements";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("get_free_quote_export_usage");

  if (error) {
    console.error("get_free_quote_export_usage error:", error);
    return NextResponse.json(
      { error: "Unable to load quote export usage" },
      { status: 500 },
    );
  }

  return NextResponse.json(data as QuoteExportUsage);
}
