import Link from "next/link";
import { Play, CheckCircle, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LandingPageClient from "@/components/LandingPageClient";

export default async function Home({
  searchParams,
}: {
  searchParams: { code?: string; type?: string };
}) {
  // Handle password reset codes that come to root URL
  if (searchParams.code) {
    // Redirect to callback with the code to handle properly
    const queryString = new URLSearchParams(searchParams as any).toString();
    redirect(`/auth/callback?${queryString}`);
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
