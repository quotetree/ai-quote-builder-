"use client";

import { useEffect, useRef, useState } from "react";
import { filterProducts } from "@/lib/filterProducts";
import type { Product } from "@/types/database";
import ProductSearchDropdown from "@/components/ProductSearchDropdown";

interface BuildProductSearchProps {
  products: Product[];
  loading?: boolean;
  onSelect: (product: Product) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function BuildProductSearch({
  products,
  loading = false,
  onSelect,
  placeholder = "Search products…",
  disabled = false,
}: BuildProductSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const suggestions = open ? filterProducts(products, query) : [];

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const inInput = inputRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inInput && !inDropdown) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  const openDropdown = () => {
    if (inputRef.current) {
      setAnchorRect(inputRef.current.getBoundingClientRect());
    }
    setOpen(true);
  };

  const handleSelect = (p: Product) => {
    setQuery(p.product_name);
    setOpen(false);
    onSelect(p);
  };

  return (
    <div ref={inputRef}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          openDropdown();
        }}
        onFocus={openDropdown}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={loading ? "Loading catalog…" : placeholder}
        className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-60"
      />
      {open && (
        <ProductSearchDropdown
          suggestions={suggestions}
          onSelect={handleSelect}
          showAddNew={false}
          anchorRect={anchorRect}
          dropdownRef={dropdownRef}
          minWidth={280}
        />
      )}
    </div>
  );
}
