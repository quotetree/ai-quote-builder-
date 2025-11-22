import Link from "next/link";
import { Play, CheckCircle, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LandingPageClient from "@/components/LandingPageClient";

export default async function Home() {
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
