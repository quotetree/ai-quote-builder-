export type ProfitMarginPdfRow = {
  productName: string;
  listPrice: number;
  salesPrice: number;
  discountPct: number;
  quantity: number;
  lineRevenue: number;
  lineMarginPct: number;
  lineProfit: number;
};

export type ProfitMarginPdfTotals = {
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
};

export type ProfitMarginPdfInput = {
  quoteName: string;
  quoteNumber: string;
  rows: ProfitMarginPdfRow[];
  totals: ProfitMarginPdfTotals;
};

const roundToCents = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundToCents(value));

const formatPercent = (rateDecimal: number): string => {
  if (!rateDecimal || Number.isNaN(rateDecimal)) return "0%";
  const percentValue = rateDecimal * 100;
  return `${percentValue.toLocaleString("en-US", {
    minimumFractionDigits: percentValue % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  })}%`;
};

const formatQuantity = (value: number): string => {
  if (Number.isInteger(value)) {
    return value.toLocaleString("en-US");
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/** Build a profit margin breakdown PDF and return it as a Blob. */
export async function generateProfitMarginPDF(input: ProfitMarginPdfInput): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(input.quoteName, marginX, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(input.quoteNumber, marginX, 52);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Profit Margin Breakdown", marginX, 72);

  const tableData = input.rows.map((row) => [
    row.productName || "-",
    formatCurrency(row.listPrice),
    formatCurrency(row.salesPrice),
    formatPercent(row.discountPct),
    formatQuantity(row.quantity),
    formatCurrency(row.lineRevenue),
    formatPercent(row.lineMarginPct),
    formatCurrency(row.lineProfit),
  ]);

  autoTable(doc, {
    startY: 84,
    head: [
      [
        "Product",
        "List Price",
        "Sales Price",
        "Disc (%)",
        "Qty",
        "Total",
        "Margin %",
        "Margin $",
      ],
    ],
    body: tableData.length > 0 ? tableData : [["No line items", "", "", "", "", "", "", ""]],
    theme: "grid",
    headStyles: {
      fillColor: [62, 62, 62],
      textColor: 255,
      fontSize: 8,
      halign: "center",
    },
    styles: { fontSize: 8, textColor: [50, 50, 50], cellPadding: 4 },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "center" },
      4: { halign: "center" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
    },
    margin: { left: marginX, right: marginX },
  });

  const finalY = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 84) + 16;
  const summaryY = finalY;
  const colWidth = (pageWidth - marginX * 2) / 4;

  const summaryItems = [
    { label: "Total Revenue", value: formatCurrency(input.totals.revenue) },
    { label: "Total Cost", value: formatCurrency(input.totals.cost) },
    { label: "Total Profit", value: formatCurrency(input.totals.profit) },
    { label: "Profit Margin %", value: formatPercent(input.totals.marginPct) },
  ];

  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, summaryY - 6, pageWidth - marginX, summaryY - 6);

  summaryItems.forEach((item, index) => {
    const x = marginX + index * colWidth;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(item.label.toUpperCase(), x, summaryY + 4);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(index === 2 ? 34 : 0, index === 2 ? 139 : 0, index === 2 ? 34 : 0);
    doc.text(item.value, x, summaryY + 18);
    doc.setTextColor(0, 0, 0);
  });

  return doc.output("blob");
}

export function downloadProfitMarginPDF(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function profitMarginPdfFilename(quoteName: string): string {
  const safe = (quoteName || "quote").trim().replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  return `${safe || "quote"}_profit_margin.pdf`;
}
