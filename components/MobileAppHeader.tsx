"use client";

import Image from "next/image";
import { Menu } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";

/**
 * Compact top bar shown only on mobile viewports. Opens the nav drawer.
 */
export default function MobileAppHeader() {
  const { isMobile, openSidebar } = useSidebar();

  if (!isMobile) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-30 h-14 flex items-center gap-3 px-3 bg-[#f9f9f9]/95 backdrop-blur border-b border-gray-200 safe-area-top">
      <button
        type="button"
        onClick={openSidebar}
        className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg hover:bg-gray-200 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu size={22} className="text-gray-800" />
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <Image
          src="/quotetree-icon.svg"
          alt="QuoteTree"
          width={32}
          height={32}
          className="w-8 h-8 mix-blend-multiply flex-shrink-0"
          style={{ background: "transparent" }}
          priority
        />
        <span className="text-sm font-semibold text-gray-900 truncate">QuoteTree</span>
      </div>
    </header>
  );
}
