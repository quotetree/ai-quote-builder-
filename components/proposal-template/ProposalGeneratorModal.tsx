"use client";

import { useMemo, useState } from "react";
import { FileText, Plus, Search, X } from "lucide-react";

export interface ProposalOption {
  id: string;
  quote_id: string;
  quote_name: string;
  project_name: string;
}

interface ProposalGeneratorModalProps {
  currentProjectName?: string;
  currentQuoteName?: string;
  proposals: ProposalOption[];
  loading?: boolean;
  onUseOrgTemplate: () => void;
  onSelectProposal: (proposalId: string) => void;
  onClose: () => void;
}

export default function ProposalGeneratorModal({
  currentProjectName,
  currentQuoteName,
  proposals,
  loading = false,
  onUseOrgTemplate,
  onSelectProposal,
  onClose,
}: ProposalGeneratorModalProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return proposals;
    return proposals.filter(
      (p) =>
        p.quote_name.toLowerCase().includes(q) ||
        p.project_name.toLowerCase().includes(q)
    );
  }, [proposals, search]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-xl shadow-2xl w-80 max-h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-700">Proposal Generator</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <button
            type="button"
            onClick={onUseOrgTemplate}
            disabled={loading}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors text-left disabled:opacity-60"
          >
            <Plus size={14} className="flex-shrink-0" />
            <div className="min-w-0">
              <p className="truncate leading-tight">Use proposal template</p>
              {(currentProjectName || currentQuoteName) && (
                <p className="text-xs text-green-200 truncate leading-tight">
                  {currentProjectName ?? "Project"}
                  {currentQuoteName ? ` — ${currentQuoteName}` : ""}
                </p>
              )}
            </div>
          </button>
        </div>

        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <Search size={13} className="text-gray-400 flex-shrink-0" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search proposals..."
              className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
          {loading ? (
            <p className="text-xs text-gray-400 italic text-center py-6">Loading proposals…</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-6">
              {proposals.length === 0 ? "No proposals found yet." : "No results."}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProposal(p.id)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-green-50 transition-colors flex items-center gap-2"
                >
                  <FileText size={13} className="text-gray-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-gray-800 truncate leading-tight">
                    {p.project_name || "Project"} — {p.quote_name}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
