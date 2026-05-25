import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ImageFormat = "PNG" | "JPEG" | "WEBP";

interface ImageAsset {
  dataUrl: string;
  format: ImageFormat;
}

async function fetchImageDataUrl(url: string): Promise<ImageAsset | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "image/png";
    let format: ImageFormat = "PNG";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      format = "JPEG";
    } else if (contentType.includes("webp")) {
      format = "WEBP";
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    // Get image dimensions using a simple approach with Image.getSize
    // For server-side, we'll use a library or extract from buffer
    // For now, we'll return dimensions that can be calculated by jsPDF
    return {
      dataUrl,
      format,
    };
  } catch (error) {
    console.warn("Unable to load company logo for PDF:", error);
    return null;
  }
}

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0);

const formatQuantity = (value: number | null | undefined) => {
  const number = value ?? 0;
  if (Number.isInteger(number)) {
    return new Intl.NumberFormat("en-US").format(number);
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
};

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "";
  if (Math.abs(value) < 0.0001) return "";
  const percentValue = value * 100;
  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: percentValue % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  });
  return `${formatter.format(percentValue)}%`;
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

/**
 * For spreadsheet-sourced quotes: proportionally allocate each SimpleMarkup's
 * calculated_amount to an eligible line item based on its share of base_total.
 */
function calcItemMarkup(
  item: { product_name: string; line_total: number },
  markups: any[]
): number {
  if (!Array.isArray(markups) || markups.length === 0) return 0;
  const simpleMarkups = markups.filter(
    (m) => typeof m?.calculated_amount === "number" && safeNumber(m?.base_total) > 0 && !m?.audited
  );
  if (simpleMarkups.length === 0) return 0;
  return simpleMarkups.reduce((total, m) => {
    const excluded: string[] = Array.isArray(m.base_excluded) ? m.base_excluded : [];
    if (m.base_applies_to === "exclude_products" && item.product_name && excluded.includes(item.product_name)) {
      return total;
    }
    const share = (item.line_total / safeNumber(m.base_total)) * safeNumber(m.calculated_amount);
    return total + share;
  }, 0);
}

const getTaxInfo = (quote: any) => {
  const fallbackRate = safeNumber(quote?.tax_rate);
  const fallbackAmount = safeNumber(quote?.tax_amount);

  const charges = Array.isArray(quote?.charges) ? quote.charges : [];
  const taxCharges = charges.filter((charge: any) =>
    (charge?.name || "").toString().toLowerCase().includes("tax")
  );

  const aggregatedRate = taxCharges.reduce((sum: number, charge: any) => sum + safeNumber(charge?.rate), 0);
  const aggregatedAmount = taxCharges.reduce(
    (sum: number, charge: any) => sum + safeNumber(charge?.calculated_amount),
    0
  );

  return {
    rate: aggregatedRate > 0 ? aggregatedRate : fallbackRate,
    amount: aggregatedAmount > 0 ? roundToCents(aggregatedAmount) : roundToCents(fallbackAmount),
  };
};

/** Shared PDF-builder — accepts either real DB data or mock sample data. */
function buildQuotePDF(opts: {
  quoteNumber: string;
  companyName: string | null;
  companyAddress: string | null;
  logoAsset: ImageAsset | null;
  items: Array<{
    product_name: string;
    unit_price: number;
    line_total: number;
    quantity: number;
    discount_percent: number;
  }>;
  subtotal: number;
  discount_amount: number;
  discount_rate: number;
  tax_rate: number;
  tax_amount: number;
  total_price: number;
  charges?: any[];
  baked_markups?: any[];
  isMock?: boolean;
}) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Optional "SAMPLE" diagonal watermark for mock/placeholder PDFs
  if (opts.isMock) {
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.07 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(72);
    doc.setTextColor(0, 0, 0);
    doc.text("SAMPLE", pageWidth / 2, pageHeight / 2, {
      align: "center",
      angle: 45,
    });
    doc.restoreGraphicsState();
  }

  const headerStartY = 20;
  let leftColumnBottom = headerStartY;

  if (opts.logoAsset) {
    try {
      const maxLogoHeight = 25;
      const imgProps = doc.getImageProperties(opts.logoAsset.dataUrl);
      const aspectRatio = imgProps.width / imgProps.height;
      const logoHeight = maxLogoHeight;
      const logoWidth = logoHeight * aspectRatio;
      doc.addImage(opts.logoAsset.dataUrl, opts.logoAsset.format, 20, headerStartY, logoWidth, logoHeight);
      leftColumnBottom = headerStartY + logoHeight + 4;
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(45, 90, 71);
      doc.text(opts.companyName || "Company Name", 20, headerStartY + 12);
      leftColumnBottom = headerStartY + 20;
    }
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(45, 90, 71);
    doc.text(opts.companyName || "Company Name", 20, headerStartY + 12);
    leftColumnBottom = headerStartY + 20;
  }

  const addressStartY = leftColumnBottom;
  if (opts.companyAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    const addressLines = doc.splitTextToSize(opts.companyAddress, pageWidth / 2 - 20);
    doc.text(addressLines, 20, addressStartY);
    leftColumnBottom = addressStartY + addressLines.length * 6 + 6;
  } else {
    leftColumnBottom = addressStartY + 6;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Quote Number: ${opts.quoteNumber}`, pageWidth - 20, addressStartY, { align: "right" });

  const tableStartY = Math.max(leftColumnBottom, headerStartY + 25) + 8;

  const bakedMarkups = opts.baked_markups ?? [];
  const tableData = opts.items.map((item) => {
    const discountPercent = safeNumber(item.discount_percent);
    const itemMarkup = roundToCents(calcItemMarkup(item, bakedMarkups));
    const displayTotal = item.line_total + itemMarkup;
    // Back-calculate sales price and list price from the markup-inclusive total
    // so that: salesPrice × qty = displayTotal and listPrice × (1 - disc) = salesPrice
    const displaySalesPrice = item.quantity > 0 ? displayTotal / item.quantity : displayTotal;
    const displayListPrice =
      discountPercent > 0 && discountPercent < 1
        ? displaySalesPrice / (1 - discountPercent)
        : displaySalesPrice;
    return [
      item.product_name || "-",
      formatCurrency(displayListPrice),
      formatPercent(item.discount_percent),
      formatCurrency(displaySalesPrice),
      formatQuantity(item.quantity),
      formatCurrency(displayTotal),
    ];
  });

  autoTable(doc, {
    startY: tableStartY,
    head: [["Product", "List Price", "Discount", "Sales Price", "Quantity", "Total Price"]],
    body: tableData.length > 0 ? tableData : [["No items", "", "", "", "", ""]],
    theme: "grid",
    headStyles: { fillColor: [62, 62, 62], textColor: 255, halign: "center" },
    styles: { fontSize: 9, textColor: [50, 50, 50] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "center" },
      3: { halign: "right" },
      4: { halign: "center" },
      5: { halign: "right" },
    },
  });

  const finalY = ((doc as any).lastAutoTable?.finalY || tableStartY) + 10;
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);

  const totalsX = pageWidth - 70;
  let currentY = finalY;

  const taxAmount = opts.charges
    ? getTaxInfo({ tax_rate: opts.tax_rate, tax_amount: opts.tax_amount, charges: opts.charges }).amount
    : roundToCents(opts.tax_amount);

  doc.text("Subtotal:", totalsX, currentY);
  doc.text(formatCurrency(opts.subtotal), pageWidth - 20, currentY, { align: "right" });

  if ((opts.discount_amount ?? 0) > 0) {
    currentY += 7;
    const discountLabel = formatPercent(opts.discount_rate);
    doc.text(`Discount${discountLabel ? ` (${discountLabel})` : ""}:`, totalsX, currentY);
    doc.text(`-${formatCurrency(opts.discount_amount)}`, pageWidth - 20, currentY, { align: "right" });
  }

  currentY += 7;
  doc.text("Tax:", totalsX, currentY);
  doc.text(formatCurrency(taxAmount), pageWidth - 20, currentY, { align: "right" });

  currentY += 10;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Total:", totalsX, currentY);
  doc.text(formatCurrency(opts.total_price), pageWidth - 20, currentY, { align: "right" });

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(
    "This quote is valid until the expiration date shown above.",
    pageWidth / 2,
    pageHeight - 20,
    { align: "center" }
  );

  return doc;
}

/** Hardcoded sample data used for template placeholder pages. */
const MOCK_QUOTE = {
  quoteNumber: "SAMPLE-001",
  companyName: "Your Company Logo",
  companyAddress: "123 Business Street\nSuite 100, City, ST 12345",
  items: [
    { product_name: "Product A — Annual License", unit_price: 199, line_total: 4298.4, quantity: 27, discount_percent: 0.2 },
    { product_name: "Service B — Installation & Setup", unit_price: 350, line_total: 350, quantity: 1, discount_percent: 0 },
  ],
  subtotal: 4648.4,
  discount_amount: 0,
  discount_rate: 0,
  tax_rate: 0,
  tax_amount: 0,
  total_price: 4648.4,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { quoteId, mock } = body;

    // ── Mock / placeholder mode (template builder design-time) ──
    if (mock === true) {
      const doc = buildQuotePDF({
        quoteNumber: MOCK_QUOTE.quoteNumber,
        companyName: MOCK_QUOTE.companyName,
        companyAddress: MOCK_QUOTE.companyAddress,
        logoAsset: null,
        items: MOCK_QUOTE.items,
        subtotal: MOCK_QUOTE.subtotal,
        discount_amount: MOCK_QUOTE.discount_amount,
        discount_rate: MOCK_QUOTE.discount_rate,
        tax_rate: MOCK_QUOTE.tax_rate,
        tax_amount: MOCK_QUOTE.tax_amount,
        total_price: MOCK_QUOTE.total_price,
        isMock: true,
      });
      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="quote-placeholder.pdf"',
        },
      });
    }

    if (!quoteId) {
      return NextResponse.json({ error: "Missing quote ID" }, { status: 400 });
    }

    // Verify authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get quote with items (RLS will enforce org membership)
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select(`
        *,
        items:quote_items(*),
        project:projects(*)
      `)
      .eq("id", quoteId)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // Get organization to find owner for company branding
    const { data: organization } = await supabase
      .from("organizations")
      .select("owner_id")
      .eq("id", quote.organization_id)
      .single();

    // Get owner's profile for company info (logo, address, etc.)
    const ownerId = organization?.owner_id || user.id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", ownerId)
      .single();

    const logoAsset = profile?.company_logo_url
      ? await fetchImageDataUrl(profile.company_logo_url)
      : null;

    // Generate PDF using shared builder
    const doc = buildQuotePDF({
      quoteNumber: quote.quote_number,
      companyName: profile?.company_name ?? null,
      companyAddress: profile?.company_address ?? null,
      logoAsset,
      items: (quote.items ?? []).map((item: any) => ({
        product_name: item.product_name || item.product_number || "-",
        unit_price: safeNumber(item.unit_price),
        line_total: safeNumber(item.line_total),
        quantity: safeNumber(item.quantity),
        discount_percent: safeNumber(item.discount_percent),
      })),
      subtotal: safeNumber(quote.subtotal),
      discount_amount: safeNumber(quote.discount_amount),
      discount_rate: safeNumber(quote.discount_rate),
      tax_rate: safeNumber(quote.tax_rate),
      tax_amount: safeNumber(quote.tax_amount),
      total_price: safeNumber(quote.total_price),
      charges: quote.charges,
      baked_markups: Array.isArray(quote.baked_markups) ? quote.baked_markups : [],
    });

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quote.quote_number}_${quote.quote_name}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

