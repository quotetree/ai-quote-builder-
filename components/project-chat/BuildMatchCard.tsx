"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Check, Loader2, Plus } from "lucide-react";
import toast from "react-hot-toast";
import type {
  BuildMatchCard,
  BuildSpreadsheetContext,
  BuildSpreadsheetSectionInfo,
} from "@/lib/ai/buildTypes";
import type { PriceBookSearchHit } from "@/lib/ai/searchPriceBook";
import type { Product } from "@/types/database";
import BuildProductSearch from "./BuildProductSearch";

type SelectionKind = "primary" | "alternative" | "other";

const NEW_SECTION = "__new_section__";
const NEW_ROW = "__new_row__";

interface BuildMatchCardProps {
  card: BuildMatchCard;
  products: Product[];
  productsLoading?: boolean;
  spreadsheetContext?: BuildSpreadsheetContext | null;
  added?: boolean;
  adding?: boolean;
  onAdd: (payload: BuildAddPayload) => Promise<void>;
}

export interface BuildAddPayload {
  itemId: string;
  sectionId: string | null;
  rowId?: string | null;
  createNewSection?: boolean;
  createNewRow?: boolean;
  productId: string | null;
  productName: string;
  productCode: string;
  listPrice: number;
  salesPrice: number;
  quantity: number;
  discount: number;
  customLabel: string;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function hitLabel(hit: PriceBookSearchHit): string {
  return hit.product_name;
}

function rowOptionLabel(customLabel: string, hasProduct: boolean): string {
  if (customLabel) {
    return hasProduct ? `${customLabel} (filled)` : customLabel;
  }
  return hasProduct ? "Row (filled)" : "Empty row";
}

function getRowOptions(section: BuildSpreadsheetSectionInfo | undefined) {
  if (!section) return [];
  return (section.rows ?? []).filter((r) => r.customLabel || !r.hasProduct);
}

export default function BuildMatchCardComponent({
  card,
  products,
  productsLoading = false,
  spreadsheetContext,
  added = false,
  adding = false,
  onAdd,
}: BuildMatchCardProps) {
  const [selectionKind, setSelectionKind] = useState<SelectionKind>("primary");
  const [selectedAltIndex, setSelectedAltIndex] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sectionId, setSectionId] = useState<string>(
    spreadsheetContext?.sections[0]?.id ?? "",
  );
  const [rowId, setRowId] = useState<string>("");

  const isLabor = card.kind === "labor_lump_sum";
  const needsPlacement = Boolean(spreadsheetContext?.requiresPlacement);
  const isNewSection = sectionId === NEW_SECTION;

  const selectedSection = useMemo(
    () => spreadsheetContext?.sections.find((s) => s.id === sectionId),
    [spreadsheetContext, sectionId],
  );

  const rowOptions = useMemo(
    () => (isNewSection ? [] : getRowOptions(selectedSection)),
    [isNewSection, selectedSection],
  );

  const activeHit: PriceBookSearchHit | null =
    selectionKind === "alternative"
      ? (card.alternatives[selectedAltIndex] ?? null)
      : selectionKind === "primary"
        ? card.primary
        : null;

  const hasMatch = Boolean(activeHit);

  const displayName = activeHit?.product_name ?? null;

  const laborSalesPrice = card.lumpSumAmount ?? 0;

  const unitPrice = isLabor
    ? laborSalesPrice
    : (activeHit?.sales_price ?? 0);

  const unit = isLabor ? "ls" : (activeHit?.unit ?? card.unit);

  const placement = (): Pick<
    BuildAddPayload,
    "sectionId" | "rowId" | "createNewSection" | "createNewRow"
  > => {
    if (!needsPlacement) {
      return {
        sectionId: spreadsheetContext?.sections[0]?.id ?? null,
        rowId: null,
        createNewSection: false,
        createNewRow: false,
      };
    }
    if (isNewSection) {
      return {
        sectionId: null,
        rowId: null,
        createNewSection: true,
        createNewRow: false,
      };
    }
    return {
      sectionId: sectionId || null,
      rowId: rowId === NEW_ROW ? null : rowId || null,
      createNewSection: false,
      createNewRow: rowId === NEW_ROW,
    };
  };

  const buildPayloadFromHit = (
    hit: PriceBookSearchHit | null,
    product?: Product,
    salesPriceOverride?: number,
  ): BuildAddPayload | null => {
    const base = placement();
    const salesPrice =
      salesPriceOverride ??
      (product ? product.sales_price : hit?.sales_price ?? 0);

    if (product) {
      return {
        ...base,
        itemId: card.itemId,
        productId: product.id,
        productName: product.product_name,
        productCode: product.product_number ?? "",
        listPrice: product.list_price,
        salesPrice,
        quantity: isLabor ? 1 : card.quantity,
        discount: card.discountPercent,
        customLabel: "",
      };
    }
    if (!hit) return null;
    return {
      ...base,
      itemId: card.itemId,
      productId: hit.id,
      productName: hit.product_name,
      productCode: hit.product_number ?? "",
      listPrice: hit.list_price,
      salesPrice,
      quantity: isLabor ? 1 : card.quantity,
      discount: card.discountPercent,
      customLabel: "",
    };
  };

  const placementValid = (): boolean => {
    if (!needsPlacement) return true;
    if (isNewSection) return true;
    if (!sectionId) return false;
    if (!rowId) return false;
    if (rowId === NEW_ROW) return true;
    const row = (selectedSection?.rows ?? []).find((r) => r.id === rowId);
    return Boolean(row && !row.hasProduct);
  };

  const tryAdd = async (payload: BuildAddPayload | null) => {
    if (!payload) return;
    if (added || adding) return;
    if (!placementValid()) {
      if (needsPlacement && !isNewSection && !sectionId) {
        toast.error("Select a section before adding to the spreadsheet");
      } else if (needsPlacement && !isNewSection && sectionId && !rowId) {
        toast.error("Select a scope category row before adding");
      } else if (needsPlacement && rowId && rowId !== NEW_ROW) {
        toast.error("That row already has a product — choose another row or New row");
      }
      return;
    }
    await onAdd(payload);
  };

  const handleSelectPrimary = () => setSelectionKind("primary");
  const handleSelectAlt = (index: number) => {
    setSelectionKind("alternative");
    setSelectedAltIndex(index);
  };
  const handleSelectOther = () => setSelectionKind("other");

  const handleOtherProductSelect = async (product: Product) => {
    setSelectionKind("other");
    await tryAdd(
      buildPayloadFromHit(null, product, isLabor ? laborSalesPrice : undefined),
    );
  };

  const handleAdd = async () => {
    await tryAdd(
      buildPayloadFromHit(
        activeHit,
        undefined,
        isLabor ? laborSalesPrice : undefined,
      ),
    );
  };

  const canAdd =
    !added &&
    !adding &&
    placementValid() &&
    Boolean(activeHit);

  const hasOptions =
    Boolean(card.primary) || card.alternatives.length > 0 || true;

  useEffect(() => {
    if (!card.primary) {
      setSelectionKind("other");
      setOptionsOpen(true);
    }
  }, [card.primary]);

  useEffect(() => {
    setRowId("");
  }, [sectionId]);

  return (
    <div className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-3 flex gap-3 items-start">
      <div className="flex-1 min-w-0 space-y-1.5">
        {hasMatch ? (
          <>
            <p className="text-sm font-semibold text-gray-900 leading-snug">{displayName}</p>
            <p className="text-xs text-gray-600">
              Qty: {isLabor ? 1 : card.quantity} {unit}
              {"  "}
              {isLabor ? "Lump sum" : "Unit Price"}: {fmt(unitPrice)}
              {!isLabor && ` per ${unit}`}
              {card.discountPercent > 0 && (
                <span className="text-gray-500"> · {card.discountPercent}% discount</span>
              )}
            </p>
            {isLabor && (
              <p className="text-xs text-gray-500">
                Requested: {card.requestedLabel}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-amber-800 leading-snug">No price book match</p>
            <p className="text-xs text-gray-600">
              Requested: {card.requestedLabel}
              {isLabor && card.lumpSumAmount != null && card.lumpSumAmount > 0 && (
                <span> · {fmt(card.lumpSumAmount)} lump sum</span>
              )}
              {card.discountPercent > 0 && (
                <span className="text-gray-500"> · {card.discountPercent}% discount requested</span>
              )}
            </p>
          </>
        )}

        {needsPlacement && spreadsheetContext && (
          <div className="pt-0.5 space-y-2">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Add to section</label>
              <select
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="">Select section…</option>
                {spreadsheetContext.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.filledRowCount > 0 ? ` (${s.filledRowCount} filled)` : ""}
                  </option>
                ))}
                <option value={NEW_SECTION}>+ New section</option>
              </select>
            </div>

            {sectionId && !isNewSection && (
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Add to scope category row</label>
                <select
                  value={rowId}
                  onChange={(e) => setRowId(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">Select row…</option>
                  {rowOptions.map((r) => (
                    <option key={r.id} value={r.id} disabled={r.hasProduct}>
                      {rowOptionLabel(r.customLabel, r.hasProduct)}
                    </option>
                  ))}
                  <option value={NEW_ROW}>+ New row</option>
                </select>
              </div>
            )}

            {isNewSection && (
              <p className="text-xs text-gray-500">
                A new untitled section will be added at the bottom of the spreadsheet.
              </p>
            )}
          </div>
        )}

        {hasOptions && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setOptionsOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white/70 px-2.5 py-1.5 text-left text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-white transition-colors"
              aria-expanded={optionsOpen}
            >
              <span>Other options</span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-gray-500 transition-transform ${optionsOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>

            {optionsOpen && (
              <ul className="mt-2 space-y-1">
                {card.primary && (
                  <li>
                    <button
                      type="button"
                      onClick={handleSelectPrimary}
                      className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                        selectionKind === "primary"
                          ? "bg-amber-100 text-gray-900 font-medium"
                          : "text-gray-600 hover:bg-amber-100/60"
                      }`}
                    >
                      {hitLabel(card.primary)}
                    </button>
                  </li>
                )}
                {card.alternatives.map((alt, i) => (
                  <li key={alt.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectAlt(i)}
                      className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                        selectionKind === "alternative" && selectedAltIndex === i
                          ? "bg-amber-100 text-gray-900 font-medium"
                          : "text-gray-600 hover:bg-amber-100/60"
                      }`}
                    >
                      {hitLabel(alt)}
                    </button>
                  </li>
                ))}
                <li className="pt-0.5">
                  <button
                    type="button"
                    onClick={handleSelectOther}
                    className={`w-full text-left text-xs px-2.5 py-1 font-medium mb-1.5 ${
                      selectionKind === "other"
                        ? "text-gray-900"
                        : "text-gray-600 hover:text-gray-800"
                    }`}
                  >
                    Other
                  </button>
                  {selectionKind === "other" && (
                    <BuildProductSearch
                      products={products}
                      loading={productsLoading}
                      disabled={added || adding}
                      onSelect={(p) => void handleOtherProductSelect(p)}
                      placeholder="Search products…"
                    />
                  )}
                </li>
              </ul>
            )}
          </div>
        )}

        {!card.primary && selectionKind !== "other" && (
          <p className="text-xs text-amber-700">
            No price book match — open Other options to search manually.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handleAdd()}
        disabled={!canAdd}
        className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {adding ? (
          <Loader2 size={14} className="animate-spin" />
        ) : added ? (
          <Check size={14} />
        ) : (
          <Plus size={14} />
        )}
        {added ? "Added" : "Add to Quote"}
      </button>
    </div>
  );
}
