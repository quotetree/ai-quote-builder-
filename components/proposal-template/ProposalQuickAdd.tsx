"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  CheckSquare,
  FileSignature,
  FileText,
  ImageIcon,
  MoreHorizontal,
  Pen,
  Plus,
  Search,
  Trash2,
  Type,
  Variable,
  X,
} from "lucide-react";
import { ElementType, ELEMENT_LABELS } from "./proposalTemplateTypes";

export interface QuoteOption {
  id: string;
  quote_number: string;
  quote_name: string;
}

const QUICK_ADD_ITEMS: { type: ElementType; icon: React.ReactNode; description: string }[] = [
  { type: "text", icon: <Type size={16} />, description: "Add a block of text" },
  { type: "image", icon: <ImageIcon size={16} />, description: "Embed an image" },
  { type: "custom_variable", icon: <Variable size={16} />, description: "Insert a custom variable" },
  { type: "signature", icon: <FileSignature size={16} />, description: "Signature field" },
  { type: "date", icon: <Calendar size={16} />, description: "Date field" },
  { type: "initial", icon: <Pen size={16} />, description: "Initials field" },
  { type: "checkbox", icon: <CheckSquare size={16} />, description: "Checkbox field" },
];

const POPOVER_WIDTH = 256;
const MARGIN = 8;

type QuickAddView = "main" | "variables" | "add_variable" | "rename_variable" | "quote_picker";

interface ProposalQuickAddProps {
  /** Screen X of the trigger button's center */
  anchorX: number;
  /** Screen Y of the trigger button's top edge */
  anchorY: number;
  customVariables: string[];
  onAdd: (type: ElementType) => void;
  onClose: () => void;
  onAddVariable: (variableName: string) => void;
  onSaveNewVariable: (variableName: string) => void;
  /** Available quotes for the picker */
  quotes?: QuoteOption[];
  /** The quote already tied to the proposal (auto-highlighted in picker) */
  currentQuoteId?: string;
  /** Called when the user picks a quote to embed */
  onAddQuote: (quoteId: string, quoteName: string, quoteNumber: string) => void;
  /** Called when the user deletes a custom variable from the list */
  onDeleteVariable?: (name: string) => void;
  /** Called when the user renames a custom variable */
  onRenameVariable?: (oldName: string, newName: string) => void;
}

function calcPosition(anchorX: number, anchorY: number, height: number) {
  const left = Math.max(
    MARGIN,
    Math.min(anchorX - POPOVER_WIDTH / 2, window.innerWidth - POPOVER_WIDTH - MARGIN)
  );
  const spaceAbove = anchorY - MARGIN;
  const top =
    spaceAbove >= height
      ? anchorY - height - 8
      : Math.max(MARGIN, (window.innerHeight - height) / 2);
  return { top, left };
}

export default function ProposalQuickAdd({
  anchorX,
  anchorY,
  customVariables,
  onAdd,
  onClose,
  onAddVariable,
  onSaveNewVariable,
  quotes = [],
  currentQuoteId,
  onAddQuote,
  onDeleteVariable,
  onRenameVariable,
}: ProposalQuickAddProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<QuickAddView>("main");
  const [search, setSearch] = useState("");
  const [newVarName, setNewVarName] = useState("");
  const [quoteSearch, setQuoteSearch] = useState("");
  // Variable management state
  const [activeVarMenu, setActiveVarMenu] = useState<string | null>(null);
  const [renamingVar, setRenamingVar] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const filteredVars = customVariables.filter((v) =>
    v.toLowerCase().includes(search.toLowerCase())
  );

  const filteredQuotes = quotes.filter(
    (q) =>
      q.quote_name.toLowerCase().includes(quoteSearch.toLowerCase()) ||
      q.quote_number.toLowerCase().includes(quoteSearch.toLowerCase())
  );

  // Current quote pinned at top (if in quote-specific mode and not already in filtered list)
  const currentQuote = currentQuoteId ? quotes.find((q) => q.id === currentQuoteId) : null;

  const handleAddNewVar = () => {
    const trimmed = newVarName.trim();
    if (!trimmed) return;
    onSaveNewVariable(trimmed);
    onAddVariable(trimmed);
    onClose();
  };

  const handleRename = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !renamingVar) return;
    onRenameVariable?.(renamingVar, trimmed);
    setRenamingVar(null);
    setRenameValue("");
    setView("variables");
  };

  /* ── Rename variable view ── */
  if (view === "rename_variable" && renamingVar) {
    const { top, left } = calcPosition(anchorX, anchorY, 185);
    return (
      <div
        ref={ref}
        style={{ position: "fixed", top, left, width: POPOVER_WIDTH, zIndex: 9999 }}
        className="bg-white border border-gray-200 rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button
            onClick={() => { setView("variables"); setRenamingVar(null); setRenameValue(""); }}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-sm font-semibold text-gray-700">Rename variable</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            placeholder="Variable Name"
            className="w-full text-sm px-0 py-1 border-b-2 border-green-500 focus:outline-none focus:border-green-600 text-gray-700 placeholder-gray-400"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setView("variables"); setRenamingVar(null); setRenameValue(""); }}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRename}
              disabled={!renameValue.trim() || renameValue.trim() === renamingVar}
              className="text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Add new variable view ── */
  if (view === "add_variable") {
    const { top, left } = calcPosition(anchorX, anchorY, 185);
    return (
      <div
        ref={ref}
        style={{ position: "fixed", top, left, width: POPOVER_WIDTH, zIndex: 9999 }}
        className="bg-white border border-gray-200 rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button
            onClick={() => setView("variables")}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-sm font-semibold text-gray-700">Add new variable</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <input
            autoFocus
            type="text"
            value={newVarName}
            onChange={(e) => setNewVarName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddNewVar()}
            placeholder="Variable Name"
            className="w-full text-sm px-0 py-1 border-b-2 border-green-500 focus:outline-none focus:border-green-600 text-gray-700 placeholder-gray-400"
          />

          <div className="flex items-center justify-between">
            <button
              onClick={() => setView("variables")}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddNewVar}
              disabled={!newVarName.trim()}
              className="text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
            >
              Add variable
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Variables browser view ── */
  if (view === "variables") {
    const { top, left } = calcPosition(anchorX, anchorY, 400);
    return (
      <div
        ref={ref}
        style={{ position: "fixed", top, left, width: POPOVER_WIDTH, maxHeight: 400, zIndex: 9999 }}
        className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-700">Variables</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Add custom variable button */}
        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <button
            onClick={() => setView("add_variable")}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus size={14} />
            Add custom variable
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <Search size={13} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
            />
          </div>
        </div>

        {/* Instruction */}
        <p className="text-xs text-gray-400 px-4 pb-2 flex-shrink-0">
          Click a variable to insert it into the template.
        </p>

        {/* Variables list */}
        <div
          className="flex-1 overflow-y-auto px-2 pb-2 min-h-0"
          onClick={() => setActiveVarMenu(null)}
        >
          {filteredVars.length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-4">
              {customVariables.length === 0 ? "No variables yet. Add one above." : "No results."}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filteredVars.map((v) => (
                <div key={v} className="relative group flex items-center rounded-lg hover:bg-green-50 transition-colors">
                  {/* Click-to-insert area */}
                  <button
                    onClick={() => {
                      onAddVariable(v);
                      onClose();
                    }}
                    className="flex-1 text-left px-3 py-2 text-xs font-mono text-green-700 truncate"
                  >
                    {`{{${v}}}`}
                  </button>

                  {/* ⋯ menu trigger */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveVarMenu((prev) => (prev === v ? null : v));
                    }}
                    className="flex-shrink-0 p-1.5 mr-1 rounded text-gray-400 hover:text-gray-600 transition-colors"
                    title="Variable options"
                  >
                    <MoreHorizontal size={13} />
                  </button>

                  {/* Inline dropdown — opens upward so it's never clipped */}
                  {activeVarMenu === v && (
                    <div
                      className="absolute right-0 bottom-full mb-0.5 z-[100] w-36 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setActiveVarMenu(null);
                          setRenamingVar(v);
                          setRenameValue(v);
                          setView("rename_variable");
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Variable size={12} className="text-gray-400" />
                        Rename
                      </button>
                      <button
                        onClick={() => {
                          setActiveVarMenu(null);
                          onDeleteVariable?.(v);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Quote picker view ── */
  if (view === "quote_picker") {
    const { top, left } = calcPosition(anchorX, anchorY, 400);
    return (
      <div
        ref={ref}
        style={{ position: "fixed", top, left, width: POPOVER_WIDTH, maxHeight: 400, zIndex: 9999 }}
        className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={() => setView("main")}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-sm font-semibold text-gray-700">Select a Quote</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Current quote shortcut */}
        {currentQuote && (
          <div className="px-3 pt-3 pb-2 flex-shrink-0">
            <button
              onClick={() => {
                onAddQuote(currentQuote.id, currentQuote.quote_name, currentQuote.quote_number);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors text-left"
            >
              <FileText size={14} className="flex-shrink-0" />
              <div className="min-w-0">
                <p className="truncate leading-tight">Use current quote</p>
                <p className="text-xs text-green-200 truncate leading-tight">
                  #{currentQuote.quote_number} — {currentQuote.quote_name}
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Search */}
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <Search size={13} className="text-gray-400 flex-shrink-0" />
            <input
              autoFocus={!currentQuote}
              type="text"
              value={quoteSearch}
              onChange={(e) => setQuoteSearch(e.target.value)}
              placeholder="Search quotes..."
              className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
            />
          </div>
        </div>

        {/* Quotes list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
          {filteredQuotes.length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-4">
              {quotes.length === 0 ? "No quotes found." : "No results."}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filteredQuotes.map((q) => (
                <button
                  key={q.id}
                  onClick={() => {
                    onAddQuote(q.id, q.quote_name, q.quote_number);
                    onClose();
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    q.id === currentQuoteId
                      ? "bg-green-50 text-green-800"
                      : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <p className="text-xs font-medium truncate leading-tight">
                    #{q.quote_number} — {q.quote_name}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Main element picker view ── */
  const { top, left } = calcPosition(anchorX, anchorY, 380);
  return (
    <div
      ref={ref}
      style={{ position: "fixed", top, left, width: POPOVER_WIDTH, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-xl shadow-2xl py-2"
    >
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100 mb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Element
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <X size={14} />
        </button>
      </div>

      {QUICK_ADD_ITEMS.map(({ type, icon, description }) => (
        <button
          key={type}
          onClick={() => {
            if (type === "custom_variable") {
              setView("variables");
            } else {
              onAdd(type);
              onClose();
            }
          }}
          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
        >
          <span className="text-gray-500 flex-shrink-0">{icon}</span>
          <div>
            <p className="font-medium leading-tight">{ELEMENT_LABELS[type]}</p>
            <p className="text-xs text-gray-400 leading-tight">{description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
