"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cleanSourceTitle, type SourceLink } from "@/lib/copilot/formatMessageContent";

interface ReferencedSourcesAccordionProps {
  sources: SourceLink[];
  label?: string;
}

export default function ReferencedSourcesAccordion({
  sources,
  label = "Referenced Sources",
}: ReferencedSourcesAccordionProps) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;

  const unique = sources.filter(
    (s, i, arr) => arr.findIndex((x) => x.url === s.url) === i,
  );

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-gray-600 hover:text-gray-800 transition-colors"
        aria-expanded={open}
      >
        <span>
          {label} ({unique.length})
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {unique.map((s) => {
            const title = cleanSourceTitle(s.title, s.url);
            return (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-green-800 hover:text-green-900 hover:underline underline-offset-2"
                >
                  <span>{title}</span>
                  <ExternalLink size={11} className="shrink-0 opacity-60" aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
