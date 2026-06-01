"use client";

import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import type { Product } from "@/types/database";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface ProductSearchDropdownProps {
  suggestions: Product[];
  onSelect: (p: Product) => void;
  onAddNew?: () => void;
  anchorRect: DOMRect | null;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  showAddNew?: boolean;
  minWidth?: number;
  /** Synced with the cell/search input — enables typing in the empty state row. */
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  emptyPlaceholder?: string;
}

/** Portal dropdown — same UI as SpreadsheetEditor product picker. */
export default function ProductSearchDropdown({
  suggestions,
  onSelect,
  onAddNew,
  anchorRect,
  dropdownRef,
  showAddNew = true,
  minWidth = 300,
  searchQuery = "",
  onSearchChange,
  emptyPlaceholder = "No products found",
}: ProductSearchDropdownProps) {
  if (!anchorRect) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
    width: Math.max(anchorRect.width, minWidth),
    zIndex: 9999,
  };

  return createPortal(
    <div
      ref={dropdownRef}
      style={style}
      className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
    >
      {showAddNew && onAddNew && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onAddNew();
          }}
          className="w-full text-left px-3 py-2.5 flex items-center gap-2 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors border-b border-gray-200 dark:border-gray-700 font-medium text-sm"
        >
          <Plus size={14} />
          Add new
        </button>
      )}

      <div className="overflow-y-auto" style={{ maxHeight: "224px" }}>
        {suggestions.length === 0 ? (
          onSearchChange ? (
            <div
              className="flex items-center gap-0.5 px-3 py-2 min-h-[44px] cursor-text"
              onMouseDown={(e) => e.preventDefault()}
            >
              <span
                className="text-sm text-gray-800 dark:text-gray-200 select-none shrink-0 leading-none"
                aria-hidden
              >
                |
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={emptyPlaceholder}
                className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </div>
          ) : (
            <p className="px-3 py-3 text-sm text-gray-400 dark:text-gray-500">{emptyPlaceholder}</p>
          )
        ) : (
          suggestions.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(p);
              }}
              className="w-full text-left px-3 py-2 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-0"
            >
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {p.product_name}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-2 mt-0.5">
                {p.product_number && <span>#{p.product_number}</span>}
                <span>{fmt(p.sales_price)}</span>
              </p>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
