"use client";

import { useState } from "react";
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  FileSignature,
  ImageIcon,
  Paperclip,
  Pen,
  Type,
  Variable,
} from "lucide-react";
import { ELEMENT_LABELS, TemplatePage, TemplateElement } from "./proposalTemplateTypes";

const TYPE_COLORS: Record<string, string> = {
  text: "bg-gray-100 text-gray-500",
  image: "bg-blue-50 text-blue-500",
  attachment: "bg-orange-50 text-orange-500",
  signature: "bg-blue-50 text-blue-600",
  date: "bg-yellow-50 text-yellow-600",
  initial: "bg-purple-50 text-purple-600",
  checkbox: "bg-green-50 text-green-600",
  custom_variable: "bg-green-50 text-green-700",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  text: <Type size={12} />,
  image: <ImageIcon size={12} />,
  attachment: <Paperclip size={12} />,
  signature: <FileSignature size={12} />,
  date: <Calendar size={12} />,
  initial: <Pen size={12} />,
  checkbox: <CheckSquare size={12} />,
  custom_variable: <Variable size={12} />,
};

function fieldLabel(el: TemplateElement): string {
  if (el.type === "custom_variable" && el.variableName) return `{{${el.variableName}}}`;
  if (el.type === "text" && el.content) {
    // Strip HTML tags for display
    const plain = el.content.replace(/<[^>]*>/g, "").trim();
    return plain.slice(0, 22) || ELEMENT_LABELS[el.type];
  }
  return ELEMENT_LABELS[el.type];
}

interface ProposalFieldManagerProps {
  pages: TemplatePage[];
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  onNavigateToPage?: (pageIndex: number) => void;
}

export default function ProposalFieldManager({
  pages,
  selectedElementId,
  onSelectElement,
  onNavigateToPage,
}: ProposalFieldManagerProps) {
  const [openPages, setOpenPages] = useState<Record<number, boolean>>({ 0: true });

  const togglePage = (idx: number) =>
    setOpenPages((prev) => ({ ...prev, [idx]: !prev[idx] }));

  const handleFieldClick = (pageIdx: number, elementId: string) => {
    onNavigateToPage?.(pageIdx);
    onSelectElement(elementId);
  };

  return (
    <div className="w-56 border-l border-gray-200 bg-white flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
          Fields
        </p>
      </div>

      {/* Page accordions */}
      <div className="flex-1 px-3 py-3 space-y-2">
        {pages.map((page, idx) => {
          const isOpen = !!openPages[idx];
          return (
            <div
              key={page.id}
              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              {/* Page header row */}
              <button
                onClick={() => togglePage(idx)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
              >
                <span>Page {idx + 1}</span>
                {isOpen ? (
                  <ChevronUp size={16} className="text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                )}
              </button>

              {/* Field list */}
              {isOpen && (
                <div className="border-t border-gray-100">
                  {page.elements.length === 0 ? (
                    <p className="text-xs text-gray-400 italic px-4 py-3">No fields yet</p>
                  ) : (
                    page.elements.map((el: TemplateElement, elIdx) => (
                      <div key={el.id}>
                        <button
                          onClick={() => handleFieldClick(idx, el.id)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            selectedElementId === el.id
                              ? "bg-blue-50"
                              : "hover:bg-gray-50"
                          }`}
                        >
                          {/* Type icon badge */}
                          <span
                            className={`flex items-center justify-center w-6 h-6 rounded flex-shrink-0 ${
                              TYPE_COLORS[el.type] ?? "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {TYPE_ICONS[el.type] ?? <Type size={12} />}
                          </span>
                          <span
                            className={`text-xs truncate ${
                              selectedElementId === el.id
                                ? "text-blue-700 font-medium"
                                : "text-gray-700"
                            }`}
                          >
                            {fieldLabel(el)}
                          </span>
                        </button>
                        {/* Divider between fields (not after the last one) */}
                        {elIdx < page.elements.length - 1 && (
                          <div className="mx-4 border-b border-gray-100" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
