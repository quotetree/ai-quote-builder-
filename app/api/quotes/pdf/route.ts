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

export async function POST(req: NextRequest) {
  try {
    const { quoteId } = await req.json();

    if (!quoteId) {
      return NextResponse.json(
        { error: "Missing quote ID" },
        { status: 400 }
      );
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

    // Generate PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    const headerStartY = 20;
    let leftColumnBottom = headerStartY;

    if (logoAsset) {
      // Set maximum height for logo (25mm) and calculate width proportionally
      const maxLogoHeight = 25;
      const imgProps = doc.getImageProperties(logoAsset.dataUrl);
      const aspectRatio = imgProps.width / imgProps.height;
      const logoHeight = maxLogoHeight;
      const logoWidth = logoHeight * aspectRatio;
      
      // Add logo at x=20 (left margin), aligned with address below
      doc.addImage(logoAsset.dataUrl, logoAsset.format, 20, headerStartY, logoWidth, logoHeight);
      leftColumnBottom = headerStartY + logoHeight + 4;
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(0, 63, 171);
      doc.text(profile?.company_name || "Company Name", 20, headerStartY + 12);
      leftColumnBottom = headerStartY + 20;
    }

    // Address and Quote Number on same baseline
    const addressStartY = leftColumnBottom;
    
    if (profile?.company_address) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      const addressLines = doc.splitTextToSize(profile.company_address, pageWidth / 2 - 20);
      doc.text(addressLines, 20, addressStartY);
      leftColumnBottom = addressStartY + addressLines.length * 6 + 6;
    } else {
      leftColumnBottom = addressStartY + 6;
    }

    // Quote Number - aligned with first line of address
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Quote Number: ${quote.quote_number}`, pageWidth - 20, addressStartY, { align: "right" });

    // Start table right after header section
    const tableStartY = Math.max(leftColumnBottom, headerStartY + 25) + 8;

    const tableData =
      quote.items?.map((item: any) => {
        // Calculate sales price from line_total (includes markup, discounts, etc.)
        const salesPrice = item.quantity > 0 ? item.line_total / item.quantity : item.unit_price;
        
        // Back-calculate list price so it matches the sales price after discount
        // This hides any markup from the customer - they'll see the math work out correctly
        const discountPercent = safeNumber(item.discount_percent);
        let displayListPrice: number;
        
        if (discountPercent > 0 && discountPercent < 1) {
          // If there's a discount, back-calculate: listPrice = salesPrice / (1 - discount)
          displayListPrice = salesPrice / (1 - discountPercent);
        } else {
          // No discount, so list price = sales price
          displayListPrice = salesPrice;
        }
        
        return [
          item.product_name || item.product_number || "-",
          formatCurrency(displayListPrice),
          formatPercent(item.discount_percent),
          formatCurrency(salesPrice),
          formatQuantity(item.quantity),
          formatCurrency(item.line_total),
        ];
      }) || [];

    autoTable(doc, {
      startY: tableStartY,
      head: [["Product", "List Price", "Discount", "Sales Price", "Quantity", "Total Price"]],
      body: tableData.length > 0 ? tableData : [["No items", "", "", "", "", ""]],
      theme: "grid",
      headStyles: {
        fillColor: [62, 62, 62],
        textColor: 255,
        halign: "center",
      },
      styles: {
        fontSize: 9,
        textColor: [50, 50, 50],
      },
      columnStyles: {
        1: { halign: "right" },  // List Price
        2: { halign: "center" }, // Discount
        3: { halign: "right" },  // Sales Price
        4: { halign: "center" }, // Quantity
        5: { halign: "right" },  // Total Price
      },
    });

    // Calculate final Y position after table
    const finalY = ((doc as any).lastAutoTable?.finalY || tableStartY) + 10;

    // Totals
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    
    const totalsX = pageWidth - 70;
    let currentY = finalY;

    const { rate: taxRate, amount: taxAmount } = getTaxInfo(quote);

    doc.text("Subtotal:", totalsX, currentY);
    doc.text(formatCurrency(quote.subtotal), pageWidth - 20, currentY, { align: "right" });

    if ((quote.discount_amount ?? 0) > 0) {
      currentY += 7;
      const discountLabel = formatPercent(quote.discount_rate);
      doc.text(
        `Discount${discountLabel ? ` (${discountLabel})` : ""}:`,
        totalsX,
        currentY
      );
      doc.text(`-${formatCurrency(quote.discount_amount)}`, pageWidth - 20, currentY, { align: "right" });
    }

    currentY += 7;
    doc.text("Tax:", totalsX, currentY);
    doc.text(formatCurrency(taxAmount), pageWidth - 20, currentY, { align: "right" });

    currentY += 10;
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Total:", totalsX, currentY);
    doc.text(formatCurrency(quote.total_price), pageWidth - 20, currentY, { align: "right" });

    // Footer
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(
      "This quote is valid until the expiration date shown above.",
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 20,
      { align: "center" }
    );

    // Generate PDF buffer
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

