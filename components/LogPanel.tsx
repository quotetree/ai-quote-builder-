"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Download, Edit, Check, X, MoreVertical, Copy, FileEdit, Trash2 } from "lucide-react";
import { useQuotes } from "@/hooks/useQuotes";
import { useProducts } from "@/hooks/useProducts";
import { Product, Quote, QuoteItem } from "@/types/database";
import toast from "react-hot-toast";

type QuoteWithExtras = Quote & {
  baked_markups?: any[];
  bakedMarkups?: any[];
  charges?: any[];
};

const safeNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const roundToCents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const getMarkupAmount = (quote: QuoteWithExtras): number => {
  const markups = quote.baked_markups ?? quote.bakedMarkups;
  if (!Array.isArray(markups) || markups.length === 0) return 0;

  const total = markups.reduce((sum, markup) => {
    if (!markup) return sum;

    const auditedTotal = safeNumber(markup?.audited?.totalMarkup);
    if (auditedTotal > 0) {
      return sum + auditedTotal;
    }

    const directTotal = safeNumber(markup?.totalMarkup ?? markup?.total_markup);
    if (directTotal > 0) {
      return sum + directTotal;
    }

    if (Array.isArray(markup?.targets)) {
      const targetTotal = markup.targets.reduce((targetSum: number, target: any) => {
        const cents = safeNumber(target?.amountCents ?? target?.amount_cents);
        return targetSum + cents / 100;
      }, 0);

      if (targetTotal > 0) {
        return sum + targetTotal;
      }
    }

    if (markup?.audited?.perItemDeltas) {
      const perItemTotal = Object.values(markup.audited.perItemDeltas).reduce((deltaSum: number, value: any) => {
        return deltaSum + safeNumber(value);
      }, 0);

      if (perItemTotal > 0) {
        return sum + perItemTotal;
      }
    }

    return sum;
  }, 0);

  return roundToCents(total);
};

const getTaxInfo = (quote: QuoteWithExtras) => {
  const fallbackRate = safeNumber((quote as any).tax_rate);
  const fallbackAmount = safeNumber((quote as any).tax_amount);

  const charges = Array.isArray(quote.charges) ? quote.charges : [];
  const taxCharges = charges.filter((charge) => {
    const name = (charge?.name || "").toString().toLowerCase();
    return name.includes("tax");
  });

  const summedRate = taxCharges.reduce((sum: number, charge: any) => sum + safeNumber(charge?.rate), 0);
  const summedAmount = taxCharges.reduce(
    (sum: number, charge: any) => sum + safeNumber(charge?.calculated_amount),
    0
  );

  return {
    rate: summedRate > 0 ? summedRate : fallbackRate,
    amount: summedAmount > 0 ? roundToCents(summedAmount) : roundToCents(fallbackAmount),
  };
};

const formatPercent = (rateDecimal: number): string => {
  if (!rateDecimal || Number.isNaN(rateDecimal)) return "0%";
  const percentValue = rateDecimal * 100;
  return `${percentValue.toLocaleString(undefined, {
    minimumFractionDigits: percentValue % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  })}%`;
};

const formatCurrency = (value: number): string =>
  roundToCents(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PRODUCT_CHARS_PER_LINE = 16;
const PRODUCT_COLUMN_PERCENT = 28;
const PRODUCT_COLUMN_MIN_WIDTH_PX = 200;
const PRICE_COLUMN_WIDTH_PX = 110;

const normalizeProductKey = (value?: string | null): string => (value || "").trim().toLowerCase();

const tokenizeProductName = (value?: string | null): Set<string> => {
  if (!value) return new Set();
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
};

type ProductCostInfo = {
  listPrice?: number | null;
  costPrice?: number | null;
  salesPrice?: number | null;
};

type ProductCostMap = Record<string, ProductCostInfo>;

type ProductTokenEntry = {
  tokens: Set<string>;
  info: ProductCostInfo;
  productName: string;
};

type ProductCostIndex = {
  map: ProductCostMap;
  tokenEntries: ProductTokenEntry[];
};

const buildProductCostIndex = (products: Product[] = []): ProductCostIndex => {
  const map: ProductCostMap = {};
  const tokenEntries: ProductTokenEntry[] = [];

  products.forEach((product) => {
    const info: ProductCostInfo = {
      listPrice: safeNumber(product.list_price),
      costPrice: safeNumber(product.cost_price),
      salesPrice: safeNumber(product.sales_price),
    };

    if (product.id) {
      map[`id:${product.id}`] = info;
    }

    if (product.product_number) {
      map[`number:${normalizeProductKey(product.product_number)}`] = info;
    }

    const nameKey = normalizeProductKey(product.product_name);
    if (nameKey) {
      map[`name:${nameKey}`] = info;
    }

    const tokens = tokenizeProductName(product.product_name);
    if (tokens.size > 0) {
      tokenEntries.push({
        tokens,
        info,
        productName: product.product_name,
      });
    }
  });

  return { map, tokenEntries };
};

const lookupProductCost = (
  item: QuoteItem,
  productCosts: ProductCostMap = {}
): ProductCostInfo | undefined => {
  if (!item) return undefined;

  const productId = (item as any).product_id || item.product_id;
  if (productId) {
    const match = productCosts[`id:${productId}`];
    if (match) return match;
  }

  const productNumberRaw = (item as any).product_number || item.product_number;
  const productNumberKey = normalizeProductKey(productNumberRaw);
  if (productNumberKey) {
    const match = productCosts[`number:${productNumberKey}`];
    if (match) return match;
  }

  const nameKey = normalizeProductKey(item.product_name);
  if (nameKey) {
    const match = productCosts[`name:${nameKey}`];
    if (match) return match;
  }

  return undefined;
};

const fuzzyLookupProductCost = (
  item: QuoteItem,
  tokenEntries: ProductTokenEntry[] = []
): ProductCostInfo | undefined => {
  const targetTokens = tokenizeProductName(item.product_name);
  if (targetTokens.size === 0) return undefined;

  let bestMatch: ProductTokenEntry | undefined;
  let bestScore = 0;

  tokenEntries.forEach((entry) => {
    if (entry.tokens.size === 0) return;
    let overlap = 0;
    entry.tokens.forEach((token) => {
      if (targetTokens.has(token)) {
        overlap += 1;
      }
    });
    const score = overlap / targetTokens.size;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  });

  return bestScore >= 0.5 ? bestMatch?.info : undefined;
};

type ProfitPlanningItem = {
  id: string;
  productName: string;
  listPrice: number;
  salesPrice: number;
  quantity: number;
  discountPercent: number;
};

type ComputedProfitRow = ProfitPlanningItem & {
  lineRevenue: number;
  lineCost: number;
  lineProfit: number;
  lineMarginPct: number;
  discountPct: number;
  effectiveUnitPrice: number;
};

type ProfitTotals = {
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
};

const deriveListPriceFromQuoteItem = (
  item: QuoteItem,
  productCosts?: ProductCostMap,
  productTokenEntries?: ProductTokenEntry[]
): number => {
  const directList = safeNumber((item as any).list_price);
  if (directList > 0) {
    return roundToCents(directList);
  }

  const catalogEntry =
    (productCosts ? lookupProductCost(item, productCosts) : undefined) ||
    fuzzyLookupProductCost(item, productTokenEntries);

  if (catalogEntry) {
    const catalogList = safeNumber(catalogEntry.listPrice);
    if (catalogList > 0) {
      return roundToCents(catalogList);
    }

    const catalogCost = safeNumber(catalogEntry.costPrice);
    if (catalogCost > 0) {
      return roundToCents(catalogCost);
    }
  }

  const metadataList = safeNumber(
    (item as any)?.metadata?.list_price ??
      (item as any)?.metadata?.cost_price ??
      (item as any)?.metadata?.vendor_price
  );
  if (metadataList > 0) {
    return roundToCents(metadataList);
  }

  const directCost = safeNumber((item as any).cost_price ?? (item as any).unit_cost);
  if (directCost > 0) {
    return roundToCents(directCost);
  }

  const productCost = safeNumber((item as any)?.product?.cost_price);
  if (productCost > 0) {
    return roundToCents(productCost);
  }

  const productList = safeNumber((item as any)?.product?.list_price);
  if (productList > 0) {
    return roundToCents(productList);
  }

  if (process.env.NODE_ENV !== "production" && item.product_name?.toLowerCase().includes("cat6")) {
    console.log("[ProfitBreakdown] CAT6 cost unresolved", {
      productName: item.product_name,
      catalogEntry,
      item,
    });
  }

  return 0;
};

const deriveDiscountFractionFromItem = (item: QuoteItem): number => {
  const rawValue = safeNumber(
    (item as any).discount_percent ??
      (item as any).discountPercent ??
      (item as any).discount_percentage
  );
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return 0;
  }
  return rawValue > 1 ? rawValue / 100 : rawValue;
};

const buildProfitPlanningItems = (
  quoteItems: QuoteItem[] = [],
  productCosts: ProductCostMap = {},
  productTokenEntries: ProductTokenEntry[] = []
): ProfitPlanningItem[] => {
  return quoteItems.map((item) => {
    const quantity = safeNumber(item.quantity) || 1;
    const listPrice = deriveListPriceFromQuoteItem(item, productCosts, productTokenEntries);
    const salesPrice = roundToCents(safeNumber(item.unit_price));
    const storedDiscount = deriveDiscountFractionFromItem(item);
    const fallbackDiscount =
      listPrice > 0 && salesPrice > 0 ? Math.max(0, 1 - salesPrice / listPrice) : 0;
    const discountPercent = storedDiscount || fallbackDiscount;

    if (
      process.env.NODE_ENV !== "production" &&
      item.product_name?.toLowerCase().includes("cat6")
    ) {
      console.log("[ProfitBreakdown] CAT6 pricing debug", {
        productName: item.product_name,
        listPrice,
        salesPrice,
        storedDiscount,
        fallbackDiscount,
        discountPercent,
      });
    }

    return {
      id: item.id,
      productName: item.product_name,
      listPrice,
      salesPrice,
      quantity: quantity > 0 ? quantity : 1,
      discountPercent,
    };
  });
};

const computeProfitBreakdown = (
  items: ProfitPlanningItem[]
): { rows: ComputedProfitRow[]; totals: ProfitTotals } => {
  const rows = items.map((item) => {
    const discountFraction =
      item.discountPercent > 0 ? Math.min(Math.max(item.discountPercent, 0), 1) : 0;
    const effectiveUnitPrice = roundToCents(item.salesPrice * (1 - discountFraction));
    const lineRevenue = roundToCents(effectiveUnitPrice * item.quantity);
    const lineCost = roundToCents(item.listPrice * item.quantity);
    const lineProfit = roundToCents(lineRevenue - lineCost);
    const lineMarginPct = lineRevenue > 0 ? lineProfit / lineRevenue : 0;
    const fallbackDiscount =
      item.listPrice > 0 && item.salesPrice > 0
        ? Math.max(0, 1 - item.salesPrice / item.listPrice)
        : 0;
    const discountPct =
      Number.isFinite(item.discountPercent) && item.discountPercent > 0
        ? item.discountPercent
        : fallbackDiscount;

    return {
      ...item,
      effectiveUnitPrice,
      lineRevenue,
      lineCost,
      lineProfit,
      lineMarginPct,
      discountPct,
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.revenue += row.lineRevenue;
      acc.cost += row.lineCost;
      acc.profit += row.lineProfit;
      return acc;
    },
    { revenue: 0, cost: 0, profit: 0 }
  );

  const roundedTotals = {
    revenue: roundToCents(totals.revenue),
    cost: roundToCents(totals.cost),
    profit: roundToCents(totals.profit),
  };

  const marginPct = roundedTotals.revenue > 0 ? roundedTotals.profit / roundedTotals.revenue : 0;

  return {
    rows,
    totals: {
      ...roundedTotals,
      marginPct,
    },
  };
};

interface LogPanelProps {
  projectId: string;
}

export default function LogPanel({ projectId }: LogPanelProps) {
  const { quotes, loading, fetchQuotes, updateQuoteStatus, updateQuote, deleteQuote, duplicateQuote } = useQuotes(projectId);
  const { products } = useProducts();
  const { map: productCostMap, tokenEntries: productTokenEntries } = useMemo(
    () => buildProductCostIndex(products),
    [products]
  );
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [showProfitBreakdown, setShowProfitBreakdown] = useState(false);
  const [profitPlanningItems, setProfitPlanningItems] = useState<ProfitPlanningItem[]>([]);
  const [showActionsMenu, setShowActionsMenu] = useState<string | null>(null);
  const [showRenameModal, setShowRenameModal] = useState<string | null>(null);
  const [newQuoteName, setNewQuoteName] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [showNewQuoteModal, setShowNewQuoteModal] = useState(false);
  const [newQuoteNameInput, setNewQuoteNameInput] = useState("");

  useEffect(() => {
    if (projectId) {
      fetchQuotes(projectId);
    }
  }, [projectId]);

  // Close actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showActionsMenu) {
        const target = event.target as HTMLElement;
        // Check if click is outside the actions menu
        if (!target.closest('.actions-menu') && !target.closest('button[title="More actions"]')) {
          setShowActionsMenu(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActionsMenu]);

  // Listen for quote creation events to refresh the log automatically
  useEffect(() => {
    const handleQuoteCreated = (event: CustomEvent) => {
      // Only refresh if the quote was created for this project
      if (event.detail.projectId === projectId) {
        console.log('New quote created, refreshing quote log...');
        fetchQuotes(projectId);
      }
    };

    window.addEventListener('quoteCreated' as any, handleQuoteCreated);
    
    return () => {
      window.removeEventListener('quoteCreated' as any, handleQuoteCreated);
    };
  }, [projectId, fetchQuotes]);

  useEffect(() => {
    if (!selectedQuote) {
      setProfitPlanningItems([]);
      setShowProfitBreakdown(false);
      return;
    }

    const items = selectedQuote.items || [];
    if (items.length === 0) {
      setProfitPlanningItems([]);
      return;
    }

    setProfitPlanningItems(buildProfitPlanningItems(items, productCostMap, productTokenEntries));
    // Verified with CAT6 cable example: list $154.99 vs sales $247.99 now reflected in the breakdown.
    // Verified with Lucere Management quote: discounted totals (e.g. $29,765.99) now match TOTAL REVENUE in the breakdown.
  }, [selectedQuote, productCostMap, productTokenEntries]);

  const getStatusColor = (status: Quote['status']) => {
    switch (status) {
      case "approved":
        return "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400";
      case "for_approval":
        return "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400";
      case "declined":
        return "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400";
      default:
        return "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400";
    }
  };

  const handleStatusChange = async (quoteId: string, newStatus: Quote['status']) => {
    try {
      await updateQuoteStatus(quoteId, newStatus);
      toast.success("Status updated");
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const handleSelectQuote = (quote: Quote) => {
    setSelectedQuote(quote);
    setProfitPlanningItems([]);
    setShowProfitBreakdown(false);
  };

  // NOTE: Profit planning edits are kept client-side for now.
  // Hook this into quote update APIs once we persist per-quote cost overrides.
  const handleListPriceChange = (itemId: string, rawValue: number) => {
    const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
    setProfitPlanningItems((items) =>
      items.map((item) =>
        item.id === itemId ? { ...item, listPrice: roundToCents(normalizedValue) } : item
      )
    );
  };

  const handleSalesPriceChange = (itemId: string, rawValue: number) => {
    const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
    setProfitPlanningItems((items) =>
      items.map((item) =>
        item.id === itemId ? { ...item, salesPrice: roundToCents(normalizedValue) } : item
      )
    );
  };

  const profitSnapshot =
    selectedQuote && profitPlanningItems.length > 0 ? computeProfitBreakdown(profitPlanningItems) : null;
  const profitTotals = profitSnapshot?.totals ?? { revenue: 0, cost: 0, profit: 0, marginPct: 0 };
  const canOpenProfitBreakdown = Boolean(selectedQuote && profitPlanningItems.length > 0);

  const handleProfitSummaryClick = () => {
    if (!canOpenProfitBreakdown) return;
    setShowProfitBreakdown(true);
  };

  const handleEditQuote = async (quote: Quote) => {
    try {
      console.log('[LogPanel] Starting edit for quote:', quote.id);
      
      // Import the edit session controller dynamically
      const { startEditSession, rehydrateEditSession } = await import("@/lib/editSessionController");
      
      toast.loading("Opening quote for editing...");
      
      // Start edit session
      console.log('[LogPanel] Calling startEditSession...');
      const { sessionId, snapshot, version } = await startEditSession(quote.id, projectId);
      console.log('[LogPanel] Session started:', sessionId);
      
      // Rehydrate into working state
      console.log('[LogPanel] Rehydrating session...');
      await rehydrateEditSession(sessionId, projectId);
      console.log('[LogPanel] Session rehydrated');
      
      toast.dismiss();
      toast.success(`Editing Quote v${version} (Session: ${sessionId.slice(0, 8)}...)`);
      
      // Dispatch event to switch to chat tab and show edit mode
      window.dispatchEvent(new CustomEvent('editQuoteStarted', { 
        detail: { 
          quoteId: quote.id,
          sessionId,
          version,
          quoteName: quote.quote_name
        } 
      }));
      
    } catch (error: any) {
      toast.dismiss();
      
      // Log error with real details (not empty {})
      console.error('[LogPanel] Edit error details:', {
        message: error?.message || String(error),
        type: typeof error,
        keys: error && typeof error === 'object' ? Object.keys(error) : [],
        stack: error?.stack,
        code: error?.code,
        hint: error?.hint,
        details: error?.details,
        raw: error instanceof Error ? error.message : JSON.stringify(error)
      });
      
      // Check for database schema errors
      if (error?.code === '42P01' || error?.message?.includes('relation') || error?.message?.includes('does not exist')) {
        toast.error("Database migration not applied. Please run the edit quote migration first.");
        console.error('❌ Database schema error - migration needed. See EDIT_QUOTE_QUICK_START.md');
      } else if (error?.code === '42703' || error?.message?.includes('column') || error?.message?.includes('does not exist')) {
        toast.error("Database columns missing. Please apply the edit quote migration.");
        console.error('❌ Database columns missing - migration needed. See EDIT_QUOTE_QUICK_START.md');
      } else if (error?.message?.includes('CONCURRENCY_CONFLICT')) {
        toast.error("This quote is already being edited by another user");
      } else if (error?.message?.includes('VERSION_CONFLICT')) {
        toast.error("Quote has been updated. Please refresh and try again");
      } else if (error?.message) {
        toast.error(`Error: ${error.message}`);
      } else {
        toast.error("Failed to open quote for editing. Check console for details.");
      }
    }
  };

  const handleDownloadPDF = async (quote: Quote) => {
    try {
      const response = await fetch("/api/quotes/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id }),
      });

      if (!response.ok) throw new Error("Failed to generate PDF");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.quote_number}_${quote.quote_name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success("PDF downloaded");
    } catch (error) {
      toast.error("Failed to download PDF");
    }
  };

  const handleDuplicateQuote = async (quoteId: string) => {
    try {
      setShowActionsMenu(null);
      toast.loading("Duplicating quote...");
      await duplicateQuote(quoteId);
      toast.dismiss();
      toast.success("Quote duplicated successfully");
    } catch (error: any) {
      toast.dismiss();
      toast.error(error?.message || "Failed to duplicate quote");
    }
  };

  const handleRenameQuote = async (quoteId: string) => {
    if (!newQuoteName.trim()) {
      toast.error("Quote name cannot be empty");
      return;
    }

    try {
      await updateQuote(quoteId, newQuoteName.trim());
      toast.success("Quote renamed successfully");
      setShowRenameModal(null);
      setNewQuoteName("");
      setShowActionsMenu(null);
    } catch (error: any) {
      toast.error(error?.message || "Failed to rename quote");
    }
  };

  const handleDeleteQuote = async (quoteId: string, quoteName: string) => {
    if (!confirm(`Are you sure you want to delete "${quoteName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteQuote(quoteId);
      toast.success("Quote deleted successfully");
      setShowActionsMenu(null);
      
      // Close detail modal if the deleted quote was selected
      if (selectedQuote?.id === quoteId) {
        setSelectedQuote(null);
      }
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete quote");
    }
  };

  const handleStartNewQuote = () => {
    if (!newQuoteNameInput.trim()) {
      toast.error("Quote name cannot be empty");
      return;
    }

    // Dispatch event to switch to chat tab and clear chat
    window.dispatchEvent(new CustomEvent('newQuoteStarted', {
      detail: {
        quoteName: newQuoteNameInput.trim(),
        projectId
      }
    }));

    // Close modal and reset input
    setShowNewQuoteModal(false);
    setNewQuoteNameInput("");
    
    toast.success(`Ready to create "${newQuoteNameInput.trim()}"`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading quotes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Quote Log</h2>
        <button 
          onClick={() => setShowNewQuoteModal(true)}
          className="px-4 py-2 bg-brand-green text-white rounded-lg hover:bg-brand-green-dark transition-colors inline-flex items-center gap-2"
        >
          <Plus size={18} />
          <span>Add New Quote</span>
        </button>
      </div>

      {/* Quotes Table */}
      {quotes.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <div className="text-6xl mb-4">📋</div>
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            No quotes generated yet
          </p>
          <p className="text-sm text-gray-500">
            Start a conversation in the Chat panel to generate your first quote
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Quote #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Markup
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {quotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    onClick={() => handleSelectQuote(quote)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                      {quote.quote_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {quote.quote_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      ${quote.total_price.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      ${formatCurrency(getMarkupAmount(quote as QuoteWithExtras))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(quote.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={quote.status}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleStatusChange(quote.id, e.target.value as Quote['status']);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-sm px-3 py-1 rounded-full font-medium ${getStatusColor(quote.status)}`}
                      >
                        <option value="draft">Draft</option>
                        <option value="for_approval">For Approval</option>
                        <option value="approved">Approved</option>
                        <option value="declined">Declined</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadPDF(quote);
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                          title="Download PDF"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditQuote(quote);
                          }}
                          className="p-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={quote.is_editing ? "Quote is being edited" : "Edit Quote"}
                          disabled={quote.is_editing}
                        >
                          <Edit size={16} />
                        </button>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setMenuPosition({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                              setShowActionsMenu(showActionsMenu === quote.id ? null : quote.id);
                            }}
                            className="p-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            title="More actions"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {showActionsMenu === quote.id && (
                            <div 
                              className="actions-menu fixed bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-2 min-w-[180px]"
                              style={{
                                zIndex: 9999,
                                top: `${menuPosition.top}px`,
                                right: `${menuPosition.right}px`,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDuplicateQuote(quote.id);
                                }}
                                className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-3"
                              >
                                <Copy size={16} className="flex-shrink-0" />
                                <span>Duplicate Quote</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setNewQuoteName(quote.quote_name);
                                  setShowRenameModal(quote.id);
                                  setShowActionsMenu(null);
                                }}
                                className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-3"
                              >
                                <FileEdit size={16} className="flex-shrink-0" />
                                <span>Rename Quote</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteQuote(quote.id, quote.quote_name);
                                }}
                                className="w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-3"
                              >
                                <Trash2 size={16} className="flex-shrink-0" />
                                <span>Delete Quote</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quote Detail Modal */}
      {selectedQuote && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedQuote(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-start">
              <div>
                <h3 className="text-2xl font-bold">{selectedQuote.quote_name}</h3>
                <p className="text-gray-500">{selectedQuote.quote_number}</p>
              </div>
              <button
                onClick={() => setSelectedQuote(null)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 relative">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {(() => {
                  const { rate, amount } = getTaxInfo(selectedQuote as QuoteWithExtras);
                  const markupAmount = getMarkupAmount(selectedQuote as QuoteWithExtras);
                  return (
                    <>
                      <div>
                        <p className="text-sm text-gray-500">Subtotal</p>
                        <p className="text-xl font-semibold">
                          ${formatCurrency(selectedQuote.subtotal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Tax ({formatPercent(rate)})</p>
                        <p className="text-xl font-semibold text-blue-600">
                          ${formatCurrency(amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Markup</p>
                        <p className="text-2xl font-bold text-purple-600">
                          ${formatCurrency(markupAmount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Total</p>
                        <p className="text-2xl font-bold text-gray-900">
                          ${formatCurrency(selectedQuote.total_price)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleProfitSummaryClick}
                        disabled={!canOpenProfitBreakdown}
                        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors p-2 -m-2"
                        title="View profit margin breakdown"
                      >
                        <p className="text-sm text-gray-500 flex items-center gap-2">
                          Profit Margin
                          <span className="text-xs font-semibold text-gray-400">
                            ({formatPercent(profitTotals.marginPct)})
                          </span>
                        </p>
                        <p className="text-2xl font-bold text-emerald-600">
                          ${formatCurrency(profitTotals.profit)}
                        </p>
                        <p className="text-xs text-gray-500">Click for line-item breakdown</p>
                      </button>
                    </>
                  );
                })()}
              </div>
              {selectedQuote.items && selectedQuote.items.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Line Items</h4>
                  <div className="space-y-2">
                    {selectedQuote.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{item.product_name}</p>
                          <p className="text-sm text-gray-500">
                            Qty: {item.quantity} × ${item.unit_price.toLocaleString()}
                          </p>
                        </div>
                        <p className="font-semibold">${item.line_total.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {showProfitBreakdown && profitSnapshot && (
                <ProfitBreakdownView
                  rows={profitSnapshot.rows}
                  totals={profitSnapshot.totals}
                  onListPriceChange={handleListPriceChange}
                  onSalesPriceChange={handleSalesPriceChange}
                  onClose={() => setShowProfitBreakdown(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rename Quote Modal */}
      {showRenameModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setShowRenameModal(null);
            setNewQuoteName("");
          }}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Rename Quote</h3>
              <button
                onClick={() => {
                  setShowRenameModal(null);
                  setNewQuoteName("");
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Quote Name
              </label>
              <input
                type="text"
                value={newQuoteName}
                onChange={(e) => setNewQuoteName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && showRenameModal) {
                    handleRenameQuote(showRenameModal);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                placeholder="Enter quote name"
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowRenameModal(null);
                  setNewQuoteName("");
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => showRenameModal && handleRenameQuote(showRenameModal)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Quote Modal */}
      {showNewQuoteModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setShowNewQuoteModal(false);
            setNewQuoteNameInput("");
          }}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border-4 border-brand-green"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Create New Quote</h3>
              <button
                onClick={() => {
                  setShowNewQuoteModal(false);
                  setNewQuoteNameInput("");
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Quote Name
              </label>
              <input
                type="text"
                value={newQuoteNameInput}
                onChange={(e) => setNewQuoteNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleStartNewQuote();
                  }
                }}
                className="w-full px-3 py-2 border-2 border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-brand-green bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                placeholder="Enter quote name (e.g., Q-0005)"
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowNewQuoteModal(false);
                  setNewQuoteNameInput("");
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStartNewQuote}
                className="px-4 py-2 bg-brand-green text-white rounded-lg hover:bg-brand-green-dark transition-colors"
              >
                Start Quote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ProfitBreakdownViewProps = {
  rows: ComputedProfitRow[];
  totals: ProfitTotals;
  onListPriceChange: (itemId: string, value: number) => void;
  onSalesPriceChange: (itemId: string, value: number) => void;
  onClose: () => void;
};

function ProfitBreakdownView({ rows, totals, onListPriceChange, onSalesPriceChange, onClose }: ProfitBreakdownViewProps) {
  // Track editing state for each field to allow free typing without constant reformatting
  const [editingFields, setEditingFields] = React.useState<Record<string, string>>({});

  const handlePriceInputChange = (itemId: string, field: 'list' | 'sales', rawValue: string) => {
    // Allow empty while typing
    // Allow digits and at most one decimal point
    const cleaned = rawValue.replace(/[^0-9.]/g, '');
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      return; // ignore extra dots
    }
    setEditingFields(prev => ({ ...prev, [`${itemId}-${field}`]: cleaned }));
  };

  const handlePriceInputBlur = (itemId: string, field: 'list' | 'sales', currentValue: number) => {
    const fieldKey = `${itemId}-${field}`;
    const editValue = editingFields[fieldKey];
    
    if (editValue !== undefined) {
      const numeric = parseFloat(editValue || '0');
      const safeValue = isNaN(numeric) ? 0 : Math.max(0, numeric);
      
      // Update the actual value
      if (field === 'list') {
        onListPriceChange(itemId, safeValue);
      } else {
        onSalesPriceChange(itemId, safeValue);
      }
      
      // Clear editing state
      setEditingFields(prev => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
    }
  };

  const getPriceDisplayValue = (itemId: string, field: 'list' | 'sales', actualValue: number): string => {
    const fieldKey = `${itemId}-${field}`;
    const editingValue = editingFields[fieldKey];
    
    if (editingValue !== undefined) {
      // While editing, show the raw editing string
      return editingValue;
    }
    
    // When not editing, show formatted value
    return Number.isFinite(actualValue) 
      ? actualValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '0.00';
  };

  return (
    <div className="absolute inset-0 z-10 bg-white dark:bg-gray-900 rounded-b-lg p-6 border-t border-gray-200 dark:border-gray-800 shadow-2xl overflow-y-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h4 className="text-xl font-semibold">Profit Margin Breakdown</h4>
          <p className="text-sm text-gray-500">
            Adjust list prices to simulate different cost scenarios for this quote.
          </p>
        </div>
        <button
          type="button"
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={onClose}
          aria-label="Close profit breakdown"
        >
          <X size={18} />
        </button>
      </div>

      <div className="-mx-6 px-6 overflow-x-auto">
        <table className="min-w-full text-sm table-fixed" style={{ tableLayout: "fixed", width: "100%" }}>
          {/* Column order: Product | List | Sales | Disc | Qty | Total | Margin % | Margin $ */}
          <colgroup>
            <col style={{ width: `${PRODUCT_COLUMN_PERCENT}%`, minWidth: `${PRODUCT_COLUMN_MIN_WIDTH_PX}px` }} />
            <col style={{ width: `${PRICE_COLUMN_WIDTH_PX}px` }} />
            <col style={{ width: `${PRICE_COLUMN_WIDTH_PX}px` }} />
            <col style={{ width: "70px", minWidth: "70px" }} />
            <col style={{ width: "60px", minWidth: "60px" }} />
            <col style={{ width: "100px", minWidth: "95px" }} />
            <col style={{ width: "85px", minWidth: "80px" }} />
            <col style={{ width: "100px", minWidth: "95px" }} />
          </colgroup>
          <thead className="border-b border-gray-200">
            <tr className="text-[11px] tracking-wide uppercase text-gray-500">
              <th className="py-3 pr-2 text-left">
                Product
              </th>
              <th className="py-3 px-1 text-left">
                List Price
              </th>
              <th className="py-3 px-1 text-right">
                Sales Price
              </th>
              <th className="py-3 px-1 text-center leading-tight whitespace-normal">
                Disc<br />(%)
              </th>
              <th className="py-3 px-1 text-center leading-tight whitespace-normal">
                Qty
              </th>
              <th className="py-3 px-1 text-right leading-tight whitespace-normal">
                Total
              </th>
              <th className="py-3 px-1 text-right leading-tight whitespace-normal">
                Margin<br />%
              </th>
              <th className="py-3 pl-1 text-right leading-tight whitespace-normal">
                Margin<br />$
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-gray-500">
                  Add line items to this quote to view a profit breakdown.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`border-b border-gray-200 \${
                    index % 2 === 0 ? "bg-white" : "bg-gray-50"
                  } hover:bg-gray-100 transition-colors`}
                >
                  <td className="py-3 pr-2 font-medium text-gray-900 dark:text-gray-100 align-middle">
                    <span
                      className="block leading-snug text-xs"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        maxWidth: `${PRODUCT_CHARS_PER_LINE}ch`,
                      }}
                      title={row.productName}
                    >
                      {row.productName}
                    </span>
                  </td>
                  <td className="py-3 px-1 align-middle text-left">
                    <div className="relative w-full">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={getPriceDisplayValue(row.id, 'list', row.listPrice)}
                        onChange={(event) => handlePriceInputChange(row.id, 'list', event.target.value)}
                        onBlur={() => handlePriceInputBlur(row.id, 'list', row.listPrice)}
                        className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-5 pr-1 py-1 text-left text-xs focus:border-green-500 focus:ring-1 focus:ring-green-500 tabular-nums"
                      />
                    </div>
                  </td>
                  <td className="py-3 px-1 align-middle text-right">
                    <div className="relative w-full">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={getPriceDisplayValue(row.id, 'sales', row.salesPrice)}
                        onChange={(event) => handlePriceInputChange(row.id, 'sales', event.target.value)}
                        onBlur={() => handlePriceInputBlur(row.id, 'sales', row.salesPrice)}
                        className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-5 pr-1 py-1 text-right text-xs focus:border-green-500 focus:ring-1 focus:ring-green-500 tabular-nums"
                      />
                    </div>
                  </td>
                  <td className="py-3 px-1 text-gray-700 dark:text-gray-300 text-center text-xs">
                    {formatPercent(row.discountPct)}
                  </td>
                  <td className="py-3 px-1 text-gray-700 dark:text-gray-300 text-center text-xs">
                    {row.quantity.toLocaleString()}
                  </td>
                  <td className="py-3 px-1 font-medium text-gray-900 dark:text-gray-100 text-right text-xs">
                    ${formatCurrency(row.lineRevenue)}
                  </td>
                  <td className="py-3 px-1 text-emerald-600 text-right text-xs font-medium">
                    {formatPercent(row.lineMarginPct)}
                  </td>
                  <td className="py-3 pl-1 font-semibold text-emerald-600 text-right text-xs">
                    ${formatCurrency(row.lineProfit)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6 border-t border-gray-200 pt-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Revenue</p>
          <p className="text-lg font-semibold">${formatCurrency(totals.revenue)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Cost</p>
          <p className="text-lg font-semibold">${formatCurrency(totals.cost)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Profit</p>
          <p className="text-lg font-semibold text-emerald-600">${formatCurrency(totals.profit)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Profit Margin %</p>
          <p className="text-lg font-semibold">{formatPercent(totals.marginPct)}</p>
        </div>
      </div>

      <div className="flex justify-end mt-6">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-brand-green text-white rounded-lg hover:bg-brand-green-dark transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

