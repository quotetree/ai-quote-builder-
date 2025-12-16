"use client";

import { useState, useEffect } from "react";
import { TableOfContentsItem } from "@/types/blog";

interface TableOfContentsProps {
  items: TableOfContentsItem[];
}

export default function TableOfContents({ items }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const headings = items.map((item) => ({
        id: item.id,
        element: document.getElementById(item.id),
      }));

      // Find the heading that is currently visible
      let currentActiveId = "";
      for (const heading of headings) {
        if (heading.element) {
          const rect = heading.element.getBoundingClientRect();
          if (rect.top <= 100 && rect.bottom >= 100) {
            currentActiveId = heading.id;
            break;
          }
          if (rect.top > 100 && !currentActiveId) {
            // If we haven't found an active heading and this one is below viewport
            break;
          }
          if (rect.top <= 100) {
            currentActiveId = heading.id;
          }
        }
      }

      setActiveId(currentActiveId);
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // Initial check

    return () => window.removeEventListener("scroll", handleScroll);
  }, [items]);

  const handleClick = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 80; // Account for sticky header
      const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({
        top: elementPosition - offset,
        behavior: "smooth",
      });
    }
    setIsOpen(false); // Close mobile menu after click
  };

  if (items.length === 0) return null;

  return (
    <>
      {/* Mobile Toggle Button */}
      <div className="lg:hidden mb-6">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-4 py-3 bg-green-50 border-2 border-green-200 rounded-lg text-green-700 font-semibold hover:bg-green-100 transition-colors"
        >
          {isOpen ? "Hide" : "Show"} Table of Contents
        </button>
      </div>

      {/* Table of Contents */}
      <div
        className={`bg-white rounded-lg border-2 border-gray-200 p-6 ${
          isOpen ? "block" : "hidden lg:block"
        } lg:sticky lg:top-24`}
      >
        <h3 className="text-lg font-bold text-gray-900 mb-4">Table of Contents</h3>
        
        <nav>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className={item.level === 3 ? "ml-4" : ""}
              >
                <button
                  onClick={() => handleClick(item.id)}
                  className={`text-left w-full py-1 text-sm transition-colors ${
                    activeId === item.id
                      ? "text-green-600 font-semibold"
                      : "text-gray-600 hover:text-green-600"
                  }`}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}

