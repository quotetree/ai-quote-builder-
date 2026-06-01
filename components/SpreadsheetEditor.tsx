"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Trash2,
  Plus,
  GripVertical,
  FileSpreadsheet,
  BookmarkPlus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  ProjectSpreadsheet,
  SpreadsheetSection,
  SpreadsheetRow,
  SpreadsheetTemplate,
  Product,
} from "@/types/database";
import { useProducts } from "@/hooks/useProducts";
import PriceBookModal from "@/components/PriceBookModal";
import ProductSearchDropdown from "@/components/ProductSearchDropdown";
import { filterProducts } from "@/lib/filterProducts";
import toast from "react-hot-toast";
import { updateProjectTimestamp } from "@/lib/updateProjectTimestamp";

// ── Types ────────────────────────────────────────────────────────────────────

interface SpreadsheetEditorProps {
  spreadsheet: ProjectSpreadsheet;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onUpdate?: (updated: ProjectSpreadsheet) => void;
  /** When set, autosave writes to spreadsheet_templates instead of project_spreadsheets */
  templateMode?: boolean;
  onTemplateUpdate?: (updated: SpreadsheetTemplate) => void;
  /** When set, the editor is in "edit existing quote" mode */
  editQuoteId?: string;
  editVersion?: number;
  editQuoteNumber?: string;
  /** Called when user saves this spreadsheet as a reusable template */
  onSaveAsTemplate?: () => Promise<void>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY = 900;
const TITLE_INPUT_MAX_WIDTH_PX = 448; // ~28rem

function SpreadsheetTitleField({
  value,
  onChange,
  saving,
  saved,
}: {
  value: string;
  onChange: (value: string) => void;
  saving: boolean;
  saved: boolean;
}) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [inputWidth, setInputWidth] = useState(48);

  useLayoutEffect(() => {
    const measured = measureRef.current?.offsetWidth ?? 48;
    setInputWidth(Math.min(Math.max(measured + 4, 32), TITLE_INPUT_MAX_WIDTH_PX));
  }, [value]);

  return (
    <div className="relative inline-flex items-center gap-2">
      <span
        ref={measureRef}
        className="pointer-events-none absolute left-0 top-0 opacity-0 whitespace-pre text-lg font-semibold leading-none"
        aria-hidden
      >
        {value || " "}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Spreadsheet title"
        style={{ width: inputWidth }}
        className="text-lg font-semibold leading-none bg-transparent border-none outline-none text-gray-900 dark:text-gray-100 focus:ring-0 shrink-0"
      />
      {(saving || saved) && (
        <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
          {saving ? "Saving…" : "Saved"}
        </span>
      )}
    </div>
  );
}

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
  discount: 0,
  quantity: 1,
});

const emptySection = (label = "Untitled section"): SpreadsheetSection => ({
  id: uid(),
  label,
  rows: [emptyRow()],
});

const fmt = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const rowAmount = (row: SpreadsheetRow) => {
  const disc = row.discount ?? 0;
  return row.sales_price * row.quantity * (1 - disc / 100);
};

// ── Phase 5 types ────────────────────────────────────────────────────────────

// Tax charge — stored in spreadsheet.charges (ChargeConfig-compatible)
interface TaxCharge {
  id: string;
  name: string;
  rate: number; // decimal (0.09 = 9%)
  applies_to: "all" | "exclude_products";
  excluded_products: string[];
  calculated_amount: number;
  applies_to_total: number;
}

// Simple markup — stored in spreadsheet.baked_markups
interface SimpleMarkup {
  id: string;
  name: string;
  mode: "percent" | "amount";
  value: number; // decimal for percent, dollars for amount
  base_applies_to: "all" | "exclude_products";
  base_excluded: string[];
  calculated_amount: number;
  base_total: number;
}

// Matches the price book's multi-term, multi-field search exactly (shared with Build mode)
// See lib/filterProducts.ts

// ── ProductDropdown wrapper ────────────────────────────────────────────────────

interface RowItemProps {
  row: SpreadsheetRow;
  sectionId: string;
  products: Product[];
  gridTemplate: string;
  updateRow: (sectionId: string, rowId: string, patch: Partial<SpreadsheetRow>) => void;
  deleteRow: (sectionId: string, rowId: string) => void;
  onAddNew: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}

function SpreadsheetRowItem({
  row,
  sectionId,
  products,
  gridTemplate,
  updateRow,
  deleteRow,
  onAddNew,
  onDragStart,
  onDragOver,
  onDrop,
}: RowItemProps) {
  const [openField, setOpenField] = useState<"name" | "code" | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const nameRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const nameDropdownRef = useRef<HTMLDivElement>(null);
  const codeDropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside both the input wrapper and the portal dropdown
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (openField === "name") {
        const inInput = nameRef.current?.contains(target);
        const inDropdown = nameDropdownRef.current?.contains(target);
        if (!inInput && !inDropdown) setOpenField(null);
      }
      if (openField === "code") {
        const inInput = codeRef.current?.contains(target);
        const inDropdown = codeDropdownRef.current?.contains(target);
        if (!inInput && !inDropdown) setOpenField(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openField]);

  // Close on scroll outside the dropdown so the fixed dropdown doesn't float out of position
  useEffect(() => {
    if (!openField) return;
    const close = (e: Event) => {
      const activeDropdownRef = openField === "name" ? nameDropdownRef : codeDropdownRef;
      if (activeDropdownRef.current?.contains(e.target as Node)) return;
      setOpenField(null);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [openField]);

  const openDropdown = (field: "name" | "code") => {
    const ref = field === "name" ? nameRef : codeRef;
    if (ref.current) setAnchorRect(ref.current.getBoundingClientRect());
    setOpenField(field);
  };

  const selectProduct = (p: Product) => {
    updateRow(sectionId, row.id, {
      product_id: p.id,
      product_name: p.product_name,
      product_code: p.product_number ?? "",
      list_price: p.list_price,
      sales_price: p.sales_price,
    });
    setOpenField(null);
  };

  const nameSuggestions = openField === "name" ? filterProducts(products, row.product_name) : [];
  const codeSuggestions = openField === "code" ? filterProducts(products, row.product_code) : [];

  const cellCls = "border-r border-gray-200 dark:border-gray-700 flex items-center min-w-0 overflow-hidden";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="grid border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors group w-full"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {/* Drag handle */}
      <div className="flex items-center justify-center text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity px-1">
        <GripVertical size={14} />
      </div>

      {/* Scope Category */}
      <div className={cellCls}>
        <input
          type="text"
          value={row.custom_label}
          onChange={(e) => updateRow(sectionId, row.id, { custom_label: e.target.value })}
          placeholder="Category…"
          className="pl-2 py-2 text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 w-full min-w-0"
        />
      </div>

      {/* Product / Service Name — live search */}
      <div className={cellCls} ref={nameRef}>
        <input
          type="text"
          value={row.product_name}
          onChange={(e) => {
            updateRow(sectionId, row.id, { product_name: e.target.value, product_id: null });
            openDropdown("name");
          }}
          onFocus={() => openDropdown("name")}
          onKeyDown={(e) => { if (e.key === "Escape") setOpenField(null); }}
          placeholder="Search products…"
          className="pl-2 py-2 text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 w-full min-w-0"
        />
        {openField === "name" && (
          <ProductSearchDropdown
            suggestions={nameSuggestions}
            onSelect={selectProduct}
            onAddNew={() => { setOpenField(null); onAddNew(); }}
            anchorRect={anchorRect}
            dropdownRef={nameDropdownRef}
            searchQuery={row.product_name}
            onSearchChange={(value) => {
              updateRow(sectionId, row.id, { product_name: value, product_id: null });
            }}
          />
        )}
      </div>

      {/* Product Code — live search by code */}
      <div className={cellCls} ref={codeRef}>
        <input
          type="text"
          value={row.product_code}
          onChange={(e) => {
            updateRow(sectionId, row.id, { product_code: e.target.value, product_id: null });
            openDropdown("code");
          }}
          onFocus={() => openDropdown("code")}
          onKeyDown={(e) => { if (e.key === "Escape") setOpenField(null); }}
          placeholder="Code…"
          className="pl-2 py-2 text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 w-full min-w-0"
        />
        {openField === "code" && (
          <ProductSearchDropdown
            suggestions={codeSuggestions}
            onSelect={selectProduct}
            onAddNew={() => { setOpenField(null); onAddNew(); }}
            anchorRect={anchorRect}
            dropdownRef={codeDropdownRef}
            searchQuery={row.product_code}
            onSearchChange={(value) => {
              updateRow(sectionId, row.id, { product_code: value, product_id: null });
            }}
          />
        )}
      </div>

      {/* List Price — auto-filled, read-only */}
      <div className={`${cellCls} justify-end`}>
        <span className="text-sm pr-3 text-gray-400 dark:text-gray-500 tabular-nums select-none">
          {row.list_price > 0 ? fmt(row.list_price) : "—"}
        </span>
      </div>

      {/* Sales Price — editable */}
      <div className={cellCls}>
        <input
          type="number"
          min={0}
          step="any"
          value={row.sales_price || ""}
          onChange={(e) =>
            updateRow(sectionId, row.id, { sales_price: Math.max(0, parseFloat(e.target.value) || 0) })
          }
          placeholder="—"
          className="py-2 text-sm text-right pr-3 bg-transparent border-none outline-none focus:ring-0 text-gray-700 dark:text-gray-300 tabular-nums font-medium w-full min-w-0"
        />
      </div>

      {/* Discount % */}
      <div className={cellCls}>
        <input
          type="number"
          min={0}
          max={100}
          step="any"
          value={row.discount ?? 0}
          onChange={(e) =>
            updateRow(sectionId, row.id, { discount: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })
          }
          onFocus={(e) => e.target.select()}
          className="py-2 text-sm text-right pr-1 bg-transparent border-none outline-none focus:ring-0 text-gray-700 dark:text-gray-300 tabular-nums w-full min-w-0"
        />
        <span className="text-xs text-gray-400 pr-1 flex-shrink-0">%</span>
      </div>

      {/* Quantity */}
      <div className={cellCls}>
        <input
          type="number"
          min={0}
          step="any"
          value={row.quantity}
          onChange={(e) =>
            updateRow(sectionId, row.id, { quantity: Math.max(0, parseFloat(e.target.value) || 0) })
          }
          className="py-2 text-sm text-right pr-3 bg-transparent border-none outline-none focus:ring-0 text-gray-800 dark:text-gray-200 tabular-nums w-full min-w-0"
        />
      </div>

      {/* Amount — computed */}
      <div className={`${cellCls} justify-end`}>
        <span className="text-sm pr-3 text-gray-800 dark:text-gray-200 tabular-nums font-medium select-none">
          {rowAmount(row) > 0 ? fmt(rowAmount(row)) : "—"}
        </span>
      </div>

      {/* Delete row */}
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => deleteRow(sectionId, row.id)}
          className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors p-1"
          aria-label="Delete row"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SpreadsheetEditor({
  spreadsheet,
  onClose,
  onDelete,
  onUpdate,
  templateMode = false,
  onTemplateUpdate,
  onSaveAsTemplate,
  editQuoteId,
  editVersion,
  editQuoteNumber,
}: SpreadsheetEditorProps) {
  const supabase = createClient();
  const { products } = useProducts();

  const [title, setTitle] = useState(spreadsheet.title);
  const [sections, setSections] = useState<SpreadsheetSection[]>(() =>
    spreadsheet.sections.length > 0 ? spreadsheet.sections : [emptySection()],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [showPriceBook, setShowPriceBook] = useState(false);

  // Tax charges
  const [taxCharges, setTaxCharges] = useState<TaxCharge[]>(
    () => (spreadsheet.charges as unknown as TaxCharge[]) ?? [],
  );
  // Markups
  const [markups, setMarkups] = useState<SimpleMarkup[]>(
    () => (spreadsheet.baked_markups as unknown as SimpleMarkup[]) ?? [],
  );

  // Tax modal state
  const blankTaxForm = () => ({ name: "Sales Tax", rate: "", appliesTo: "all" as "all" | "exclude_products", selectedProducts: [] as string[] });
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [taxForm, setTaxForm] = useState(blankTaxForm);

  // Markup modal state
  const blankMarkupForm = () => ({ name: "Markup", rate: "", lumpSum: "", baseAppliesTo: "all" as "all" | "exclude_products", baseSelected: [] as string[], showAdvanced: false });
  const [showMarkupModal, setShowMarkupModal] = useState(false);
  const [editingMarkupId, setEditingMarkupId] = useState<string | null>(null);
  const [markupForm, setMarkupForm] = useState(blankMarkupForm);

  // Column widths (px) for the 8 resizable content columns:
  // [Scope Category, Product/Service Name, Product Code, List Price, Sales Price, Discount, Qty, Amount]
  const [colWidths, setColWidths] = useState([150, 220, 130, 100, 100, 64, 64, 100]);

  const gridTemplate = `32px ${colWidths.map((w) => `${w}px`).join(" ")} 28px`;

  const handleResizeMouseDown = (colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[colIdx];
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      const newW = Math.max(48, startW + (ev.clientX - startX));
      setColWidths((prev) => {
        const next = [...prev];
        next[colIdx] = newW;
        return next;
      });
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  // Drag state for row reordering (within a section)
  const dragRowRef = useRef<{ rowId: string; sectionId: string } | null>(null);
  const dragOverRowRef = useRef<{ rowId: string; sectionId: string } | null>(null);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync rows added from Build mode chat
  useEffect(() => {
    const handleLineItemAdded = (e: Event) => {
      const detail = (e as CustomEvent<{
        spreadsheetId: string;
        sections: SpreadsheetSection[];
        subtotal?: number;
        total?: number;
      }>).detail;
      if (!detail || detail.spreadsheetId !== spreadsheet.id) return;
      setSections(detail.sections);
      setSaved(true);
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
    window.addEventListener("spreadsheetLineItemAdded", handleLineItemAdded as EventListener);
    return () =>
      window.removeEventListener("spreadsheetLineItemAdded", handleLineItemAdded as EventListener);
  }, [spreadsheet.id]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const subtotal = sections.reduce(
    (acc, s) => acc + s.rows.reduce((a, r) => a + rowAmount(r), 0),
    0,
  );
  const taxTotal = taxCharges.reduce((a, c) => a + (c.calculated_amount ?? 0), 0);
  const markupTotal = markups.reduce((a, m) => a + (m.calculated_amount ?? 0), 0);
  const total = subtotal + taxTotal + markupTotal;

  // All line items across sections (for Exclude selector in modals)
  const allLineItems = sections.flatMap((s) =>
    s.rows
      .filter((r) => r.product_name || r.custom_label)
      .map((r) => ({ name: r.product_name || r.custom_label || "Item", amount: rowAmount(r) })),
  );

  // ── Persistence ───────────────────────────────────────────────────────────

  const persist = useCallback(
    async (
      latestSections: SpreadsheetSection[],
      latestTitle: string,
      latestCharges: TaxCharge[],
      latestMarkups: SimpleMarkup[],
    ): Promise<boolean> => {
      const sub = latestSections.reduce(
        (acc, s) => acc + s.rows.reduce((a, r) => a + rowAmount(r), 0),
        0,
      );
      const tot =
        sub +
        latestCharges.reduce((a, c) => a + (c.calculated_amount ?? 0), 0) +
        latestMarkups.reduce((a, m) => a + (m.calculated_amount ?? 0), 0);
      setSaving(true);
      try {
        if (templateMode) {
          const { data, error } = await supabase
            .from("spreadsheet_templates")
            .update({
              title: latestTitle,
              sections: latestSections,
              charges: latestCharges,
              baked_markups: latestMarkups as unknown as never,
            })
            .eq("id", spreadsheet.id)
            .select()
            .single();
          if (error) throw error;
          if (data) onTemplateUpdate?.(data as SpreadsheetTemplate);
        } else {
          const { data, error } = await supabase
            .from("project_spreadsheets")
            .update({
              title: latestTitle,
              sections: latestSections,
              charges: latestCharges,
              baked_markups: latestMarkups as unknown as never,
              subtotal: sub,
              total: tot,
            })
            .eq("id", spreadsheet.id)
            .select()
            .single();
          if (error) throw error;
          if (data) onUpdate?.(data as ProjectSpreadsheet);
        }
        setSaved(true);
        return true;
      } catch {
        toast.error(templateMode ? "Failed to autosave template" : "Failed to autosave spreadsheet");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [spreadsheet.id, supabase, onUpdate, onTemplateUpdate, templateMode],
  );

  const scheduleSave = useCallback(
    (latestSections: SpreadsheetSection[], latestTitle: string) => {
      setSaved(false);
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(
        () => persist(latestSections, latestTitle, taxCharges, markups),
        AUTOSAVE_DELAY,
      );
    },
    [persist, taxCharges, markups],
  );

  // ── Tax charge handlers ───────────────────────────────────────────────────

  const openAddTax = () => {
    setEditingChargeId(null);
    setTaxForm(blankTaxForm());
    setShowTaxModal(true);
  };

  const openEditTax = (c: TaxCharge) => {
    setEditingChargeId(c.id);
    setTaxForm({
      name: c.name,
      rate: String(+(c.rate * 100).toFixed(4)),
      appliesTo: c.applies_to,
      selectedProducts: c.excluded_products,
    });
    setShowTaxModal(true);
  };

  const submitTaxCharge = () => {
    const rate = parseFloat(taxForm.rate) / 100 || 0;
    const eligible =
      taxForm.appliesTo === "all"
        ? allLineItems
        : allLineItems.filter((i) => !taxForm.selectedProducts.includes(i.name));
    const eligibleTotal = eligible.reduce((a, i) => a + i.amount, 0);
    const charge: TaxCharge = {
      id: editingChargeId ?? uid(),
      name: taxForm.name,
      rate,
      applies_to: taxForm.appliesTo,
      excluded_products: taxForm.selectedProducts,
      calculated_amount: eligibleTotal * rate,
      applies_to_total: eligibleTotal,
    };
    const next = editingChargeId
      ? taxCharges.map((c) => (c.id === editingChargeId ? charge : c))
      : [...taxCharges, charge];
    setTaxCharges(next);
    persist(sections, title, next, markups);
    setShowTaxModal(false);
  };

  const deleteTaxCharge = (id: string) => {
    const next = taxCharges.filter((c) => c.id !== id);
    setTaxCharges(next);
    persist(sections, title, next, markups);
  };

  // ── Markup handlers ───────────────────────────────────────────────────────

  const openAddMarkup = () => {
    setEditingMarkupId(null);
    setMarkupForm(blankMarkupForm());
    setShowMarkupModal(true);
  };

  const openEditMarkup = (m: SimpleMarkup) => {
    setEditingMarkupId(m.id);
    setMarkupForm({
      name: m.name,
      rate: m.mode === "percent" ? String(+(m.value * 100).toFixed(4)) : "",
      lumpSum: m.mode === "amount" ? String(m.value) : "",
      baseAppliesTo: m.base_applies_to,
      baseSelected: m.base_excluded,
      showAdvanced: false,
    });
    setShowMarkupModal(true);
  };

  const submitMarkup = () => {
    const rate = parseFloat(markupForm.rate) / 100 || 0;
    const lump = parseFloat(markupForm.lumpSum) || 0;
    const mode: "percent" | "amount" = lump > 0 ? "amount" : "percent";
    const value = mode === "amount" ? lump : rate;
    const baseItems =
      markupForm.baseAppliesTo === "all"
        ? allLineItems
        : allLineItems.filter((i) => !markupForm.baseSelected.includes(i.name));
    const baseTotal = baseItems.reduce((a, i) => a + i.amount, 0);
    const calcAmount = mode === "amount" ? lump : baseTotal * rate;
    const markup: SimpleMarkup = {
      id: editingMarkupId ?? uid(),
      name: markupForm.name,
      mode,
      value,
      base_applies_to: markupForm.baseAppliesTo,
      base_excluded: markupForm.baseSelected,
      calculated_amount: calcAmount,
      base_total: baseTotal,
    };
    const next = editingMarkupId
      ? markups.map((m) => (m.id === editingMarkupId ? markup : m))
      : [...markups, markup];
    setMarkups(next);
    persist(sections, title, taxCharges, next);
    setShowMarkupModal(false);
  };

  const deleteMarkup = (id: string) => {
    const next = markups.filter((m) => m.id !== id);
    setMarkups(next);
    persist(sections, title, taxCharges, next);
  };

  // ── Submit to Quote Log ───────────────────────────────────────────────────

  const [submitting, setSubmitting] = useState(false);

  const saveTemplate = async () => {
    setSubmitting(true);
    try {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      const ok = await persist(sections, title, taxCharges, markups);
      if (!ok) return;
      toast.success("Template saved");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const submitToQuoteLog = async () => {
    const lineItems = sections.flatMap((s) =>
      s.rows.filter((r) => r.product_name?.trim()),
    );
    if (lineItems.length === 0) {
      toast.error("Add at least one product before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const quotePayload = {
        subtotal,
        tax_rate: 0,
        tax_amount: taxTotal,
        discount_rate: 0,
        discount_amount: 0,
        total_price: total,
        profit_margin: 0,
        charges: taxCharges,
        baked_markups: markups as unknown as never,
        spreadsheet_id: spreadsheet.id,
        scope_of_work: "Generated from spreadsheet",
        status: "draft" as const,
        quote_name: title || spreadsheet.title,
      };

      let quoteNumber: string;
      let quoteId: string;
      let savedVersion: number | null = null;

      // Resolve an existing quote: explicit edit context, or spreadsheet link
      let existingQuoteId = editQuoteId ?? null;
      let existingVersion = editVersion ?? null;
      let existingQuoteNumber = editQuoteNumber ?? null;

      if (!existingQuoteId) {
        const { data: linked } = await supabase
          .from("quotes")
          .select("id, quote_number, version_number")
          .eq("spreadsheet_id", spreadsheet.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (linked) {
          existingQuoteId = linked.id;
          existingVersion = linked.version_number ?? 1;
          existingQuoteNumber = linked.quote_number;
        }
      }

      if (existingQuoteId) {
        // ── Update existing quote in place (same row, no duplicate in log) ──
        const baseVersion = existingVersion ?? 1;
        const newVersion = baseVersion + 1;

        const { error: quoteError } = await supabase
          .from("quotes")
          .update({
            ...quotePayload,
            version_number: newVersion,
          })
          .eq("id", existingQuoteId);

        if (quoteError) throw quoteError;

        const { error: deleteItemsError } = await supabase
          .from("quote_items")
          .delete()
          .eq("quote_id", existingQuoteId);

        if (deleteItemsError) throw deleteItemsError;

        quoteId = existingQuoteId;
        quoteNumber = existingQuoteNumber ?? "";
        savedVersion = newVersion;
      } else {
        // ── New quote ─────────────────────────────────────────────────────
        const { count } = await supabase
          .from("quotes")
          .select("*", { count: "exact", head: true })
          .eq("project_id", spreadsheet.project_id);

        quoteNumber = `Q-${String((count || 0) + 1).padStart(4, "0")}`;

        const { data: quote, error: quoteError } = await supabase
          .from("quotes")
          .insert({
            ...quotePayload,
            project_id: spreadsheet.project_id,
            user_id: user.id,
            quote_number: quoteNumber,
            version_number: 1,
          })
          .select()
          .single();

        if (quoteError) throw quoteError;
        quoteId = quote.id;
        savedVersion = 1;
      }

      const quoteItems = lineItems.map((row, index) => ({
        quote_id: quoteId,
        product_id: row.product_id ?? null,
        product_number: row.product_code || null,
        product_name: row.product_name,
        description: null,
        quantity: row.quantity,
        unit_price: row.sales_price,
        discount_percent: (row.discount ?? 0) / 100,
        line_total: rowAmount(row),
        sort_order: index,
      }));

      const { error: itemsError } = await supabase
        .from("quote_items")
        .insert(quoteItems);

      if (itemsError) throw itemsError;

      await updateProjectTimestamp(spreadsheet.project_id);

      window.dispatchEvent(
        new CustomEvent("quoteCreated", {
          detail: { projectId: spreadsheet.project_id, quoteId },
        }),
      );

      const label = savedVersion && savedVersion > 1
        ? `${quoteNumber} v${savedVersion} saved successfully!`
        : `Quote ${quoteNumber} saved successfully!`;
      toast.success(label);
      onClose();
    } catch (err) {
      console.error("[SpreadsheetEditor] submitToQuoteLog error:", err);
      toast.error("Failed to save quote. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

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
      sections.map((s) => {
        if (s.id !== sectionId) return s;
        if (s.rows.length <= 1) {
          return { ...s, rows: [emptyRow()] };
        }
        return { ...s, rows: s.rows.filter((r) => r.id !== rowId) };
      }),
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
    autosaveTimer.current = setTimeout(() => persist(sections, val, taxCharges, markups), AUTOSAVE_DELAY);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 bg-gray-50 dark:bg-gray-950 z-30 flex flex-col overflow-hidden">

      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
        <div className="inline-flex items-center gap-3 min-w-0 shrink">
          <div className="w-8 h-8 rounded-lg bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet size={16} />
          </div>
          <SpreadsheetTitleField
            value={title}
            onChange={handleTitleChange}
            saving={saving}
            saved={saved}
          />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {templateMode && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs font-medium text-amber-800 flex-shrink-0">
              <FileSpreadsheet size={12} />
              Editing template
            </div>
          )}
          {editQuoteId && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs font-medium text-amber-800 flex-shrink-0">
              <FileSpreadsheet size={12} />
              Editing {editQuoteNumber ?? "quote"}
              {editVersion != null ? ` (v${editVersion})` : ""}
            </div>
          )}
          {!templateMode && onSaveAsTemplate && (
            <button
              type="button"
              onClick={onSaveAsTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-green-700 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 border border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-700 transition-all"
              aria-label="Save as template"
            >
              <BookmarkPlus size={15} />
              Save as template
            </button>
          )}
          {!templateMode && onDelete && (
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
          )}
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
              {/* Column headers with resize handles */}
              <div
                className="grid items-stretch bg-gray-50 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide select-none"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {/* drag-handle placeholder */}
                <div className="px-4 py-2" />

                {[
                  { label: "Scope Category", align: "left" },
                  { label: "Product / Service Name", align: "left" },
                  { label: "Product Code", align: "left" },
                  { label: "List Price", align: "right" },
                  { label: "Sales Price", align: "right" },
                  { label: "Disc %", align: "right" },
                  { label: "Qty", align: "right" },
                  { label: "Amount", align: "right" },
                ].map(({ label, align }, i) => (
                  <div
                    key={label}
                    className="relative border-r border-gray-200 dark:border-gray-700 hover:border-green-400 dark:hover:border-green-500 flex items-center py-2 min-w-0 overflow-hidden transition-colors"
                  >
                    <span className={`flex-1 ${align === "right" ? "text-right pr-3" : "pl-2 pr-4"} truncate`}>
                      {label}
                    </span>
                    {/* Invisible wide hit-area for resize cursor */}
                    <div
                      className="absolute inset-y-0 right-0 w-3 cursor-col-resize z-10"
                      onMouseDown={(e) => handleResizeMouseDown(i, e)}
                    />
                  </div>
                ))}

                {/* delete-btn placeholder */}
                <div className="py-2" />
              </div>

              {/* Rows */}
              {section.rows.map((row) => (
                <SpreadsheetRowItem
                  key={row.id}
                  row={row}
                  sectionId={section.id}
                  products={products}
                  gridTemplate={gridTemplate}
                  updateRow={updateRow}
                  deleteRow={deleteRow}
                  onAddNew={() => setShowPriceBook(true)}
                  onDragStart={() => handleRowDragStart(row.id, section.id)}
                  onDragOver={(e) => handleRowDragOver(e, row.id, section.id)}
                  onDrop={() => handleRowDrop(section.id)}
                />
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
        <div className="px-6 pt-4 pb-4 flex items-end justify-between gap-8">

          {/* Pricing stack */}
          <div className="flex-1 space-y-2">

            {/* Subtotal row */}
            <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
              <span>Subtotal:</span>
              <span className="tabular-nums">{fmt(subtotal)}</span>
            </div>

            {/* CHARGES */}
            {taxCharges.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider pt-1">Charges</p>
                {taxCharges.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => openEditTax(c)}
                        className="text-sm text-gray-700 dark:text-gray-300 hover:text-green-600 text-left"
                      >
                        {c.name} ({+(c.rate * 100).toFixed(2)}% of {fmt(c.applies_to_total)}):
                      </button>
                      {c.applies_to === "exclude_products" && c.excluded_products.length > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          Excludes: {c.excluded_products.join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm tabular-nums text-gray-700 dark:text-gray-300">{fmt(c.calculated_amount)}</span>
                      <button type="button" onClick={() => deleteTaxCharge(c.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* BAKED MARKUPS */}
            {markups.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider pt-1">Baked Markups</p>
                {markups.map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => openEditMarkup(m)}
                        className="text-sm text-gray-700 dark:text-gray-300 hover:text-green-600 text-left"
                      >
                        {m.name} {m.mode === "percent" ? `(${+(m.value * 100).toFixed(2)}%)` : `(${fmt(m.value)} flat)`}:
                      </button>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        Base: {fmt(m.base_total)}
                        {m.base_applies_to === "exclude_products" && m.base_excluded.length > 0
                          ? ` → Excludes: ${m.base_excluded.join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm tabular-nums text-gray-700 dark:text-gray-300">{fmt(m.calculated_amount)}</span>
                      <button type="button" onClick={() => deleteMarkup(m.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Tax / Add Markup buttons */}
            <div className="flex items-center gap-4 pt-1">
              <button
                type="button"
                onClick={openAddTax}
                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium"
              >
                <Plus size={14} /> Add Tax
              </button>
              <button
                type="button"
                onClick={openAddMarkup}
                className="flex items-center gap-1 text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 font-medium"
              >
                <Plus size={14} /> Add Markup
              </button>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-gray-900 dark:text-gray-100">Total:</span>
                <span className="text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* Save / Submit */}
          <button
            type="button"
            onClick={templateMode ? saveTemplate : submitToQuoteLog}
            disabled={submitting}
            className="px-6 py-1.5 rounded-xl bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors shadow-sm flex-shrink-0"
          >
            {submitting
              ? "Saving…"
              : templateMode
                ? "Save"
                : editQuoteId
                  ? "Save changes"
                  : "Submit"}
          </button>
        </div>
      </div>

      {/* ── Tax/Charge Modal ──────────────────────────────────────────────── */}
      {showTaxModal && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" onClick={() => setShowTaxModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Add Tax/Charge</h3>
                <button onClick={() => setShowTaxModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Charge Name</label>
                <input
                  type="text"
                  value={taxForm.name}
                  onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Sales Tax"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Percentage (%)</label>
                <input
                  type="number"
                  value={taxForm.rate}
                  onChange={(e) => setTaxForm({ ...taxForm, rate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 9.5"
                  step="0.1"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Applies To</label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input type="radio" checked={taxForm.appliesTo === "all"} onChange={() => setTaxForm({ ...taxForm, appliesTo: "all", selectedProducts: [] })} className="mr-2" />
                    <span className="text-sm">All items</span>
                  </label>
                  <label className="flex items-center">
                    <input type="radio" checked={taxForm.appliesTo === "exclude_products"} onChange={() => setTaxForm({ ...taxForm, appliesTo: "exclude_products" })} className="mr-2" />
                    <span className="text-sm">Exclude...</span>
                  </label>
                </div>
              </div>

              {taxForm.appliesTo === "exclude_products" && allLineItems.length > 0 && (
                <div className="pl-6 space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  {allLineItems.map((item, i) => (
                    <label key={i} className="flex items-start">
                      <input
                        type="checkbox"
                        checked={taxForm.selectedProducts.includes(item.name)}
                        onChange={(e) => setTaxForm({
                          ...taxForm,
                          selectedProducts: e.target.checked
                            ? [...taxForm.selectedProducts, item.name]
                            : taxForm.selectedProducts.filter((p) => p !== item.name),
                        })}
                        className="mr-2 mt-0.5"
                      />
                      <div className="flex-1">
                        <span className="text-sm">{item.name}</span>
                        <span className="text-xs text-gray-500 ml-2">({fmt(item.amount)})</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {taxForm.rate && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  {(() => {
                    const rate = parseFloat(taxForm.rate) / 100 || 0;
                    const eligible = taxForm.appliesTo === "all" ? allLineItems : allLineItems.filter((i) => !taxForm.selectedProducts.includes(i.name));
                    const eligibleTotal = eligible.reduce((a, i) => a + i.amount, 0);
                    return (
                      <div className="text-sm text-blue-900">
                        <strong>Preview:</strong> Applies to {eligible.length} items totaling {fmt(eligibleTotal)}
                        <div className="text-xs text-blue-700 mt-1">Charge amount: {fmt(eligibleTotal * rate)}</div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowTaxModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">Cancel</button>
                <button onClick={submitTaxCharge} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Add Charge</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Markup Modal ──────────────────────────────────────────────────── */}
      {showMarkupModal && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" onClick={() => setShowMarkupModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{editingMarkupId ? "Edit" : "Add"} Markup (baked)</h3>
                <button onClick={() => setShowMarkupModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Charge Name</label>
                <input
                  type="text"
                  value={markupForm.name}
                  onChange={(e) => setMarkupForm({ ...markupForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., Markup"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Percentage (%)</label>
                <input
                  type="number"
                  value={markupForm.rate}
                  onChange={(e) => setMarkupForm({ ...markupForm, rate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., 7.5"
                  step="0.1"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lump Sum ($)</label>
                <input
                  type="number"
                  value={markupForm.lumpSum}
                  onChange={(e) => setMarkupForm({ ...markupForm, lumpSum: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g., 2000"
                  step="0.01"
                  min="0"
                />
                <p className="text-xs text-gray-500 mt-1">Enter a fixed amount instead of a percentage.</p>
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Base Applies To</label>
                <p className="text-xs text-gray-500 mb-2">Items used to calculate the markup amount</p>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input type="radio" checked={markupForm.baseAppliesTo === "all"} onChange={() => setMarkupForm({ ...markupForm, baseAppliesTo: "all", baseSelected: [] })} className="mr-2" />
                    <span className="text-sm">All items</span>
                  </label>
                  <label className="flex items-center">
                    <input type="radio" checked={markupForm.baseAppliesTo === "exclude_products"} onChange={() => setMarkupForm({ ...markupForm, baseAppliesTo: "exclude_products" })} className="mr-2" />
                    <span className="text-sm">Exclude...</span>
                  </label>
                </div>
                {markupForm.baseAppliesTo === "exclude_products" && allLineItems.length > 0 && (
                  <div className="pl-6 mt-2 space-y-2 max-h-32 overflow-y-auto border border-gray-200 rounded p-2">
                    {allLineItems.map((item, i) => (
                      <label key={i} className="flex items-start">
                        <input
                          type="checkbox"
                          checked={markupForm.baseSelected.includes(item.name)}
                          onChange={(e) => setMarkupForm({
                            ...markupForm,
                            baseSelected: e.target.checked
                              ? [...markupForm.baseSelected, item.name]
                              : markupForm.baseSelected.filter((p) => p !== item.name),
                          })}
                          className="mr-2 mt-0.5"
                        />
                        <div className="flex-1">
                          <span className="text-sm">{item.name}</span>
                          <span className="text-xs text-gray-500 ml-2">({fmt(item.amount)})</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {(markupForm.rate || markupForm.lumpSum) && (() => {
                const rate = parseFloat(markupForm.rate) / 100 || 0;
                const lump = parseFloat(markupForm.lumpSum) || 0;
                const mode = lump > 0 ? "amount" : "percent";
                const baseItems = markupForm.baseAppliesTo === "all" ? allLineItems : allLineItems.filter((i) => !markupForm.baseSelected.includes(i.name));
                const baseTotal = baseItems.reduce((a, i) => a + i.amount, 0);
                const markupAmt = mode === "amount" ? lump : baseTotal * rate;
                return (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-900 space-y-1">
                    <div><strong>Base:</strong> {baseItems.length} items totaling {fmt(baseTotal)}</div>
                    <div><strong>Markup Amount:</strong> {fmt(markupAmt)} {mode === "amount" ? "(lump sum)" : `(${markupForm.rate}%)`}</div>
                    <div className="text-xs text-purple-700 italic mt-1">The markup will be added to the total</div>
                  </div>
                );
              })()}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowMarkupModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">Cancel</button>
                <button onClick={submitMarkup} className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium">
                  {editingMarkupId ? "Update Markup" : "Add Markup"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Price Book modal — portalled to document.body to escape stacking context */}
      {showPriceBook && createPortal(
        <PriceBookModal
          isOpen={showPriceBook}
          onClose={() => setShowPriceBook(false)}
          initialView="new-product"
        />,
        document.body,
      )}
    </div>
  );
}
