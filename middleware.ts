import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: any) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/webhooks (Stripe webhooks don't need auth)
     * - api/stripe/checkout (Landing page checkout doesn't need auth)
     * - api/auth/reset-password-email (Password reset API doesn't need auth)
     * - checkout/success (Success page for unauthenticated purchases)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/stripe/webhook|api/stripe/checkout|api/auth/reset-password-email|checkout/success|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

