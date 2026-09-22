"use client";

import { useSidebar } from "@/contexts/SidebarContext";

export default function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isOpen, isMobile } = useSidebar();

  return (
    <main
      className={`min-h-screen min-w-0 transition-all duration-300 ${
        isMobile
          ? "pl-0 pt-14"
          : isOpen
            ? "pl-64"
            : "pl-14"
      }`}
    >
      {children}
    </main>
  );
}
