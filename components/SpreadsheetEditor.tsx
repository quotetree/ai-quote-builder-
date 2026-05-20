"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Trash2,
  Plus,
  GripVertical,
  FileSpreadsheet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  ProjectSpreadsheet,
  SpreadsheetSection,
  SpreadsheetRow,
} from "@/types/database";
import toast from "react-hot-toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface SpreadsheetEditorProps {
  spreadsheet: ProjectSpreadsheet;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (updated: ProjectSpreadsheet) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY = 900;

// ── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();

const emptyRow = (): SpreadsheetRow => ({
  id: uid(),
  custom_label: "",
  product_id: null,
  product_name: "",
  product_code: "",
  list_price: 0,
  sales_price: 0,
  quantity: 1,
});

const emptySection = (label = "Product or service"): SpreadsheetSection => ({
  id: uid(),
  label,
  rows: [emptyRow()],
});

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const rowAmount = (row: SpreadsheetRow) => row.sales_price * row.quantity;

// ── Component ────────────────────────────────────────────────────────────────

export default function SpreadsheetEditor({
  spreadsheet,
  onClose,
  onDelete,
  onUpdate,
}: SpreadsheetEditorProps) {
  const supabase = createClient();

  const [title, setTitle] = useState(spreadsheet.title);
  const [sections, setSections] = useState<SpreadsheetSection[]>(() =>
    spreadsheet.sections.length > 0 ? spreadsheet.sections : [emptySection()],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);

  // Drag state for row reordering (within a section)
  const dragRowRef = useRef<{ rowId: string; sectionId: string } | null>(null);
  const dragOverRowRef = useRef<{ rowId: string; sectionId: string } | null>(null);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Computed ──────────────────────────────────────────────────────────────

  const subtotal = sections.reduce(
    (acc, s) => acc + s.rows.reduce((a, r) => a + rowAmount(r), 0),
    0,
  );

  // ── Persistence ───────────────────────────────────────────────────────────

  const persist = useCallback(
    async (latestSections: SpreadsheetSection[], latestTitle: string) => {
      const sub = latestSections.reduce(
        (acc, s) => acc + s.rows.reduce((a, r) => a + rowAmount(r), 0),
        0,
      );
      setSaving(true);
      try {
        const { data, error } = await supabase
          .from("project_spreadsheets")
          .update({
            title: latestTitle,
            sections: latestSections,
            subtotal: sub,
            total: sub,
          })
          .eq("id", spreadsheet.id)
          .select()
          .single();
        if (error) throw error;
        if (data) onUpdate(data as ProjectSpreadsheet);
        setSaved(true);
      } catch {
        toast.error("Failed to autosave spreadsheet");
      } finally {
        setSaving(false);
      }
    },
    [spreadsheet.id, supabase, onUpdate],
  );

  const scheduleSave = useCallback(
    (latestSections: SpreadsheetSection[], latestTitle: string) => {
      setSaved(false);
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(
        () => persist(latestSections, latestTitle),
        AUTOSAVE_DELAY,
      );
    },
    [persist],
  );

  // Flush on unmount
  useEffect(
    () => () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    },
    [],
  );

  // ── Section helpers ───────────────────────────────────────────────────────

  const updateSections = useCallback(
    (next: SpreadsheetSection[], currentTitle = title) => {
      setSections(next);
      scheduleSave(next, currentTitle);
    },
    [scheduleSave, title],
  );

  const updateSectionLabel = (sectionId: string, label: string) =>
    updateSections(
      sections.map((s) => (s.id === sectionId ? { ...s, label } : s)),
    );

  const addSection = () =>
    updateSections([...sections, emptySection()]);

  const deleteSection = (sectionId: string) => {
    if (sections.length === 1) {
      toast.error("A spreadsheet must have at least one section");
      return;
    }
    updateSections(sections.filter((s) => s.id !== sectionId));
  };

  // ── Row helpers ───────────────────────────────────────────────────────────

  const updateRow = (
    sectionId: string,
    rowId: string,
    patch: Partial<SpreadsheetRow>,
  ) =>
    updateSections(
      sections.map((s) =>
        s.id !== sectionId
          ? s
          : { ...s, rows: s.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) },
      ),
    );

  const addRow = (sectionId: string) =>
    updateSections(
      sections.map((s) =>
        s.id !== sectionId ? s : { ...s, rows: [...s.rows, emptyRow()] },
      ),
    );

  const deleteRow = (sectionId: string, rowId: string) =>
    updateSections(
      sections.map((s) =>
        s.id !== sectionId ? s : { ...s, rows: s.rows.filter((r) => r.id !== rowId) },
      ),
    );

  // ── Row drag-and-drop (within same section) ───────────────────────────────

  const handleRowDragStart = (rowId: string, sectionId: string) => {
    dragRowRef.current = { rowId, sectionId };
  };

  const handleRowDragOver = (
    e: React.DragEvent,
    rowId: string,
    sectionId: string,
  ) => {
    e.preventDefault();
    dragOverRowRef.current = { rowId, sectionId };
  };

  const handleRowDrop = (sectionId: string) => {
    const from = dragRowRef.current;
    const to = dragOverRowRef.current;
    dragRowRef.current = null;
    dragOverRowRef.current = null;
    if (!from || !to || from.sectionId !== sectionId || from.rowId === to.rowId) return;

    updateSections(
      sections.map((s) => {
        if (s.id !== sectionId) return s;
        const rows = [...s.rows];
        const fromIdx = rows.findIndex((r) => r.id === from.rowId);
        const toIdx = rows.findIndex((r) => r.id === to.rowId);
        if (fromIdx < 0 || toIdx < 0) return s;
        const [moved] = rows.splice(fromIdx, 1);
        rows.splice(toIdx, 0, moved);
        return { ...s, rows };
      }),
    );
  };

  // ── Title ─────────────────────────────────────────────────────────────────

  const handleTitleChange = (val: string) => {
    setTitle(val);
    setSaved(false);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => persist(sections, val), AUTOSAVE_DELAY);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-gray-50 dark:bg-gray-950 z-30 flex flex-col overflow-hidden">

      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet size={16} />
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            aria-label="Spreadsheet title"
            className="text-lg font-semibold bg-transparent border-none outline-none text-gray-900 dark:text-gray-100 min-w-0 w-64 focus:ring-0"
          />
          <span className="text-xs text-gray-400 flex-shrink-0 w-14">
            {saving ? "Saving…" : saved ? "Saved" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete this spreadsheet? This cannot be undone.")) {
                onDelete(spreadsheet.id);
              }
            }}
            className="p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            aria-label="Delete spreadsheet"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close spreadsheet"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {sections.map((section) => (
          <div
            key={section.id}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
          >
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
              <input
                type="text"
                value={section.label}
                onChange={(e) => updateSectionLabel(section.id, e.target.value)}
                aria-label="Section label"
                className="font-semibold text-sm text-gray-800 dark:text-gray-200 bg-transparent border-none outline-none focus:ring-0 w-full"
              />
              <button
                type="button"
                onClick={() => deleteSection(section.id)}
                className="ml-2 p-1 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                aria-label="Delete section"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Horizontally scrollable table */}
            <div className="overflow-x-auto">
              {/* Column headers */}
              <div
                className="grid items-center px-4 py-2 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                style={{ gridTemplateColumns: "32px 28px 1fr 1.5fr 1fr 96px 96px 64px 96px 40px", minWidth: "860px" }}
              >
                <span />
                <span className="text-center">#</span>
                <span className="pl-2">Product / Service</span>
                <span className="pl-2">Product Name</span>
                <span className="pl-2">Product Code</span>
                <span className="text-right pr-2">List Price</span>
                <span className="text-right pr-2">Sales Price</span>
                <span className="text-right pr-2">Qty</span>
                <span className="text-right pr-2">Amount</span>
                <span />
              </div>

              {/* Rows */}
              {section.rows.map((row, rowIdx) => (
                <div
                  key={row.id}
                  draggable
                  onDragStart={() => handleRowDragStart(row.id, section.id)}
                  onDragOver={(e) => handleRowDragOver(e, row.id, section.id)}
                  onDrop={() => handleRowDrop(section.id)}
                  className="grid items-center px-4 py-1.5 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors group"
                  style={{ gridTemplateColumns: "32px 28px 1fr 1.5fr 1fr 96px 96px 64px 96px 40px", minWidth: "860px" }}
                >
                  {/* Drag handle */}
                  <span className="flex items-center justify-center text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical size={14} />
                  </span>

                  {/* Row number */}
                  <span className="text-xs text-gray-400 text-center select-none tabular-nums">
                    {rowIdx + 1}
                  </span>

                  {/* Product / Service — free text */}
                  <input
                    type="text"
                    value={row.custom_label}
                    onChange={(e) =>
                      updateRow(section.id, row.id, { custom_label: e.target.value })
                    }
                    placeholder="Custom label"
                    className="pl-2 py-1 text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 w-full"
                  />

                  {/* Product Name — Phase 3 adds live search dropdown */}
                  <input
                    type="text"
                    value={row.product_name}
                    onChange={(e) =>
                      updateRow(section.id, row.id, {
                        product_name: e.target.value,
                        product_id: null,
                      })
                    }
                    placeholder="Search products…"
                    className="pl-2 py-1 text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 w-full"
                  />

                  {/* Product Code — Phase 3 adds live search dropdown */}
                  <input
                    type="text"
                    value={row.product_code}
                    onChange={(e) =>
                      updateRow(section.id, row.id, {
                        product_code: e.target.value,
                        product_id: null,
                      })
                    }
                    placeholder="Code…"
                    className="pl-2 py-1 text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 w-full"
                  />

                  {/* List Price — read-only, auto-filled in Phase 3 */}
                  <span className="text-sm text-right pr-2 text-gray-400 dark:text-gray-500 tabular-nums select-none">
                    {row.list_price > 0 ? fmt(row.list_price) : "—"}
                  </span>

                  {/* Sales Price — read-only, auto-filled in Phase 3 */}
                  <span className="text-sm text-right pr-2 text-gray-700 dark:text-gray-300 tabular-nums font-medium select-none">
                    {row.sales_price > 0 ? fmt(row.sales_price) : "—"}
                  </span>

                  {/* Quantity */}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={row.quantity}
                    onChange={(e) =>
                      updateRow(section.id, row.id, {
                        quantity: Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="text-sm text-right pr-2 bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 tabular-nums w-full"
                  />

                  {/* Amount — computed */}
                  <span className="text-sm text-right pr-2 text-gray-800 dark:text-gray-200 tabular-nums font-medium select-none">
                    {rowAmount(row) > 0 ? fmt(rowAmount(row)) : "—"}
                  </span>

                  {/* Delete row */}
                  <button
                    type="button"
                    onClick={() => deleteRow(section.id, row.id)}
                    className="flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    aria-label="Delete row"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add row */}
            <div className="px-5 py-2.5">
              <button
                type="button"
                onClick={() => addRow(section.id)}
                className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 font-medium transition-colors"
              >
                <Plus size={15} />
                Add product or service
              </button>
            </div>
          </div>
        ))}

        {/* Add section */}
        <button
          type="button"
          onClick={addSection}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-400 dark:text-gray-500 hover:border-green-400 dark:hover:border-green-600 hover:text-green-600 dark:hover:text-green-400 transition-colors"
        >
          <Plus size={15} />
          Add section
        </button>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* Divider line */}
        <div className="px-6 pt-4 pb-3 flex items-end justify-between gap-6 flex-wrap">
          {/* Tax / Markup actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                toast("Tax configuration coming in Phase 5", { icon: "🔜" })
              }
              className="px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
            >
              + Add Tax
            </button>
            <button
              type="button"
              onClick={() =>
                toast("Markup configuration coming in Phase 5", { icon: "🔜" })
              }
              className="px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
            >
              + Add Markup
            </button>
          </div>

          {/* Totals + Submit */}
          <div className="flex items-center gap-8">
            <div className="text-right">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide">
                Subtotal
              </p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                {fmt(subtotal)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide">
                Total
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                {fmt(subtotal)}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                toast("Submit to quote log coming in Phase 6", { icon: "🔜" })
              }
              className="px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-sm transition-colors shadow-sm"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
