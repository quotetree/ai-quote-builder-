"use client";

import { useSidebar } from "@/contexts/SidebarContext";

export default function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isOpen } = useSidebar();

  return (
    <main
      className={`min-h-screen transition-all duration-300 ${
        isOpen ? "pl-64" : "pl-14"
      }`}
    >
      {children}
    </main>
  );
}

