import Link from "next/link";
import { Play, CheckCircle, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LandingPageClient from "@/components/LandingPageClient";

export default async function Home({
  searchParams,
}: {
  searchParams: { code?: string; type?: string; next?: string };
}) {
  // Handle password reset codes that come to root URL
  if (searchParams.code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(searchParams.code);
    
    if (!error) {
      // Successfully exchanged code for session
      // If there's no 'next' parameter, assume it's password reset
      if (!searchParams.next) {
        redirect("/auth/reset-password");
      }
      // Otherwise follow the next parameter
      redirect(searchParams.next || "/dashboard");
    }
    
    // If code exchange failed, continue to show landing page
    console.error("Code exchange failed:", error);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If user is logged in, redirect to dashboard
  if (user) {
    redirect("/dashboard");
  }

  return <LandingPageClient />;
}
