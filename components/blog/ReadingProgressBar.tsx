"use client";

import { useEffect, useRef, useState } from "react";

export default function ReadingProgressBar() {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    
    const updateProgress = () => {
      if (!progressBarRef.current) return;
      
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const scrollProgress = scrollHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / scrollHeight) * 100)) : 0;
      
      progressBarRef.current.style.width = `${scrollProgress}%`;
    };

    // Update on scroll
    window.addEventListener("scroll", updateProgress, { passive: true });
    
    // Update on resize
    window.addEventListener("resize", updateProgress, { passive: true });
    
    // Initial update
    updateProgress();

    return () => {
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, []);

  // Don't render during SSR to avoid hydration mismatch
  if (!isMounted) {
    return null;
  }

  return (
    <div className="fixed top-[88px] left-0 w-full h-1 bg-transparent z-[60]">
      <div
        ref={progressBarRef}
        className="h-full bg-green-600 transition-all duration-200 ease-out"
        style={{ width: "0%" }}
      />
    </div>
  );
}

