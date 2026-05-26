"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Compass, ChevronDown, RotateCcw, X } from "lucide-react";
import ScopeModePanel from "./ScopeModePanel";
import PlanModePanel, { type ModeChatPanelHandle } from "./PlanModePanel";

export type ChatAssistantMode = "scope" | "plan";

interface ProjectChatPanelProps {
  projectId: string;
  projectName: string;
  activeSpreadsheetId?: string | null;
  className?: string;
  onClose?: () => void;
}

export default function ProjectChatPanel({
  projectId,
  projectName,
  activeSpreadsheetId = null,
  className = "",
  onClose,
}: ProjectChatPanelProps) {
  const [mode, setMode] = useState<ChatAssistantMode>("plan");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  const [contextError, setContextError] = useState<string | null>(null);
  const planPanelRef = useRef<ModeChatPanelHandle>(null);
  const scopePanelRef = useRef<ModeChatPanelHandle>(null);

  const loadContext = async () => {
    setContextError(null);
    try {
      const params = new URLSearchParams({ projectId });
      if (activeSpreadsheetId) params.set("spreadsheetId", activeSpreadsheetId);
      const res = await fetch(`/api/ai/context?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load context (${res.status})`);
      }
      await res.json();
    } catch (e) {
      setContextError(e instanceof Error ? e.message : "Failed to load context");
    }
  };

  useEffect(() => {
    void loadContext();
  }, [projectId, activeSpreadsheetId]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const modeLabel = mode === "scope" ? "Scope" : "Plan";
  const ModeIcon = mode === "scope" ? FileText : Compass;

  const handleClearChat = () => {
    const panel = mode === "plan" ? planPanelRef.current : scopePanelRef.current;
    void panel?.clearChat();
  };

  return (
    <aside
      className={`flex flex-col h-full bg-white border-l border-gray-200 ${className}`}
      aria-label="Project assistant"
    >
      <header className="shrink-0 px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Assistant
          </p>
          <p className="text-sm font-semibold text-gray-900 truncate">{projectName}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleClearChat}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
            title="Clear conversation"
          >
            <RotateCcw size={14} className="shrink-0" aria-hidden />
            Clear chat
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              aria-label="Close chat"
              title="Close chat"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {contextError && (
        <p className="shrink-0 px-4 py-1 text-xs text-red-600 border-b border-gray-100">
          {contextError}
        </p>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        {mode === "scope" ? (
          <ScopeModePanel
            ref={scopePanelRef}
            projectId={projectId}
            activeSpreadsheetId={activeSpreadsheetId}
          />
        ) : (
          <PlanModePanel
            ref={planPanelRef}
            projectId={projectId}
            activeSpreadsheetId={activeSpreadsheetId}
          />
        )}
      </div>

      <footer className="shrink-0 border-t border-gray-200 px-3 py-2">
        <div className="relative" ref={modeMenuRef}>
          <button
            type="button"
            onClick={() => setModeMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-100"
          >
            <ModeIcon size={12} />
            {modeLabel}
            <ChevronDown size={12} className="text-gray-500" />
          </button>
          {modeMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-40 rounded-lg border border-gray-200 bg-white shadow-lg py-1 z-30">
              <button
                type="button"
                onClick={() => {
                  setMode("plan");
                  setModeMenuOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  mode === "plan" ? "text-gray-900 font-medium" : "text-gray-600"
                }`}
              >
                <Compass size={14} />
                Plan
                {mode === "plan" && <span className="ml-auto text-green-600">✓</span>}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("scope");
                  setModeMenuOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  mode === "scope" ? "text-gray-900 font-medium" : "text-gray-600"
                }`}
              >
                <FileText size={14} />
                Scope
                {mode === "scope" && <span className="ml-auto text-green-600">✓</span>}
              </button>
            </div>
          )}
        </div>
      </footer>
    </aside>
  );
}
