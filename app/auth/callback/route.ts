import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      // Only password recovery when explicitly marked — do not treat missing next as recovery
      const isRecovery = type === "recovery";

      if (isRecovery) {
        console.log("Password recovery detected, redirecting to reset-password");
        return NextResponse.redirect(`${origin}/auth/reset-password`);
      }

      const redirectPath =
        next && next.startsWith("/") ? next : "/dashboard";
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${redirectPath}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${redirectPath}`);
      } else {
        return NextResponse.redirect(`${origin}${redirectPath}`);
      }
    }
  }

  // Handle hash-based recovery tokens (legacy flow)
  const hash = new URL(request.url).hash;
  if (type === "recovery" && hash) {
    return NextResponse.redirect(`${origin}/auth/reset-password${hash}`);
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
