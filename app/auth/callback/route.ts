import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin, hash } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error && data.session) {
      // Explicitly check for password recovery
      // If type=recovery OR if there's no next parameter (password reset doesn't set next), assume recovery
      const hasNoNext = !next;
      const isRecovery = type === "recovery" || hasNoNext;
      
      if (isRecovery) {
        // For password recovery, always redirect to reset-password page
        console.log("Password recovery detected, redirecting to reset-password");
        return NextResponse.redirect(`${origin}/auth/reset-password`);
      }
      
      // Normal authentication flow with explicit next parameter
      const redirectPath = next ?? "/dashboard";
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
  if (type === "recovery" && hash) {
    return NextResponse.redirect(`${origin}/auth/reset-password${hash}`);
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}

