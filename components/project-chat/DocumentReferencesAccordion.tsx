"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";

export interface DocumentCitation {
  fileName: string;
  pageStart: number;
  pageEnd: number;
}

function formatPageRef(pageStart: number, pageEnd: number): string {
  return pageStart === pageEnd ? `p. ${pageStart}` : `pp. ${pageStart}–${pageEnd}`;
}

interface DocumentReferencesAccordionProps {
  citations: DocumentCitation[];
}

export default function DocumentReferencesAccordion({
  citations,
}: DocumentReferencesAccordionProps) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-gray-600 hover:text-gray-800 transition-colors"
        aria-expanded={open}
      >
        <span>Document references ({citations.length})</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {citations.map((c, i) => (
            <li
              key={`${c.fileName}-${c.pageStart}-${i}`}
              className="flex items-start gap-1.5 text-xs text-gray-700"
            >
              <FileText size={12} className="shrink-0 mt-0.5 text-gray-400" aria-hidden />
              <span>
                <span className="font-medium text-gray-800">{c.fileName}</span>
                <span className="text-gray-500"> — {formatPageRef(c.pageStart, c.pageEnd)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
