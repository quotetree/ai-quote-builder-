import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NewSidebar from "@/components/NewSidebar";
import DashboardContent from "@/components/DashboardContent";
import { Toaster } from "react-hot-toast";
import { SidebarProvider } from "@/contexts/SidebarContext";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/signin");
  }

  // Get user profile for name
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-white">
        <NewSidebar userEmail={user.email} userName={profile?.full_name} />
        <DashboardContent>{children}</DashboardContent>
        <Toaster position="top-right" />
      </div>
    </SidebarProvider>
  );
}

