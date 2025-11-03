import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { projectId, message, history } = await req.json();

    if (!projectId || !message) {
      return NextResponse.json(
        { error: "Missing required fields" },
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

    // Get project details
    const { data: project } = await supabase
      .from("projects")
      .select("*, product_families")
      .eq("id", projectId)
      .single();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get relevant products from price book
    // Set high limit to fetch all products (Supabase default is 1000)
    const { data: products } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", user.id)
      .limit(10000);

    // Check if price book is empty
    if (!products || products.length === 0) {
      return NextResponse.json({ 
        message: "I'd love to help you create a quote, but I notice your Price Book is empty!\n\n📚 **To proceed, you'll need to:**\n1. Click **\"Price Book\"** in the sidebar\n2. Add products and their pricing\n3. Come back here and we can start building your quote!\n\nYour price book will help me understand what products and services you offer, so I can create accurate quotes for you." 
      });
    }

    // Build system context with product details
    const productContext = products.slice(0, 30).map((p: any) => 
      `• ${p.product_name} - $${p.sales_price} ${p.unit ? `per ${p.unit}` : ''}\n  ${p.description || 'No description'}\n  Type: ${p.product_type || 'General'}`
    ).join("\n\n");

    const systemPrompt = `You are an AI estimator for ${project.project_name}. Your goal is to help create accurate, professional quotes through conversation.

## Available Products & Services:
${productContext || 'No products in price book yet'}

## Conversation Flow:
1. **Understand Scope**: If this is the first message, ask for the scope of work
2. **Clarify Details**: Ask 2-3 targeted questions about:
   - Specific equipment/product needs
   - Quantities or project size  
   - Timeline or special requirements
   - Any preferences (brands, quality levels)
3. **Confirm Before Quoting**: Once you have enough detail, say: "I have enough information. Would you like me to generate a quote?"
4. **Generate Quote**: Only after permission, create a detailed quote using this format:

---
**QUOTE GENERATED**

**Line Items:**
| Item | Description | Qty | Unit Price | Total |
|------|-------------|-----|-----------|-------|
| Product Name | Brief desc | X | $X.XX | $X.XX |

**Subtotal:** $X,XXX.XX
**Tax (9%):** $XXX.XX
**Total:** $X,XXX.XX

**Projected Profit Margin:** $XXX.XX
---

5. **Review**: Ask: "Does this quote look ready to commit to your Quote Log? Or would you like me to make any changes?"

## Rules:
- Use products from the price book above
- Be conversational and helpful
- Ask clarifying questions before generating
- Show math clearly
- Always ask permission before generating
- Keep responses concise but professional
- If they want changes, revise and show updated quote`;


    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const aiResponse = completion.choices[0].message.content;

    return NextResponse.json({ message: aiResponse });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

