import Link from "next/link";
import { Play, CheckCircle, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LandingPageClient from "@/components/LandingPageClient";

// Force dynamic rendering - don't cache this page
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home({
  searchParams,
}: {
  searchParams: { code?: string; type?: string; next?: string; error?: string; error_code?: string; error_description?: string };
}) {
  // Handle password reset codes that come to root URL
  if (searchParams.code) {
    console.log('=== CODE EXCHANGE ATTEMPT ===');
    console.log('Code:', searchParams.code);
    console.log('Next:', searchParams.next);
    console.log('Type:', searchParams.type);
    
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(searchParams.code);
    
    console.log('Exchange result:', { 
      hasSession: !!data?.session, 
      hasUser: !!data?.user,
      error: error?.message 
    });
    
    if (!error && data.session) {
      // Successfully exchanged code for session
      console.log('✅ Code exchange successful, redirecting to reset-password');
      redirect("/auth/reset-password");
    }
    
    // If code exchange failed, log and show error
    console.error("❌ Code exchange failed:", error);
    console.error("Error details:", { 
      message: error?.message, 
      status: error?.status,
      name: error?.name 
    });
  }

  // Check for error parameters from Supabase
  if (searchParams.error) {
    console.error('Supabase redirect error:', {
      error: searchParams.error,
      error_code: searchParams.error_code,
      error_description: searchParams.error_description
    });
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
