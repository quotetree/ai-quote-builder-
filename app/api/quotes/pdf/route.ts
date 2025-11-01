import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

    // Get quote with items
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select(`
        *,
        items:quote_items(*),
        project:projects(project_name)
      `)
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // Get user profile for company info
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Generate PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header - Company Logo and Info
    doc.setFontSize(20);
    doc.setTextColor(37, 99, 235); // Blue
    doc.text(profile?.company_name || "Company Name", 20, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    if (profile?.company_address) {
      doc.text(profile.company_address, 20, 28);
    }

    // Quote Number and Date
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Quote #${quote.quote_number}`, pageWidth - 20, 20, { align: "right" });
    doc.text(`Date: ${new Date(quote.created_at).toLocaleDateString()}`, pageWidth - 20, 27, { align: "right" });
    if (quote.expiration_date) {
      doc.text(`Expires: ${new Date(quote.expiration_date).toLocaleDateString()}`, pageWidth - 20, 34, { align: "right" });
    }

    // Quote Title
    doc.setFontSize(16);
    doc.text(quote.quote_name, 20, 45);

    // Project Name
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Project: ${(quote.project as any).project_name}`, 20, 52);

    // Line Items Table
    const tableData = quote.items?.map((item: any) => [
      item.product_number || "-",
      item.product_name,
      item.quantity.toString(),
      `$${item.unit_price.toFixed(2)}`,
      item.discount_percent > 0 ? `${item.discount_percent}%` : "-",
      `$${item.line_total.toFixed(2)}`,
    ]) || [];

    autoTable(doc, {
      startY: 60,
      head: [["Product #", "Description", "Qty", "Unit Price", "Discount", "Total"]],
      body: tableData,
      theme: "striped",
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
      },
      styles: {
        fontSize: 9,
      },
    });

    // Calculate final Y position after table
    const finalY = (doc as any).lastAutoTable.finalY + 10;

    // Totals
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    
    const totalsX = pageWidth - 70;
    let currentY = finalY;

    doc.text("Subtotal:", totalsX, currentY);
    doc.text(`$${quote.subtotal.toFixed(2)}`, pageWidth - 20, currentY, { align: "right" });

    if (quote.discount_amount > 0) {
      currentY += 7;
      doc.text(`Discount (${quote.discount_rate}%):`, totalsX, currentY);
      doc.text(`-$${quote.discount_amount.toFixed(2)}`, pageWidth - 20, currentY, { align: "right" });
    }

    currentY += 7;
    doc.text(`Tax (${quote.tax_rate}%):`, totalsX, currentY);
    doc.text(`$${quote.tax_amount.toFixed(2)}`, pageWidth - 20, currentY, { align: "right" });

    currentY += 10;
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("Total:", totalsX, currentY);
    doc.text(`$${quote.total_price.toFixed(2)}`, pageWidth - 20, currentY, { align: "right" });

    // Projected Profit (if available)
    if (quote.profit_margin > 0) {
      currentY += 10;
      doc.setFontSize(11);
      doc.setTextColor(34, 197, 94); // Green
      doc.text("Projected Margin:", totalsX, currentY);
      doc.text(`$${quote.profit_margin.toFixed(2)}`, pageWidth - 20, currentY, { align: "right" });
    }

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

