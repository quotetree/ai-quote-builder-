import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Quote, QuoteItem } from "@/types/database";

export function useQuotes(projectId?: string) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (projectId) {
      fetchQuotes(projectId);
    }
  }, [projectId]);

  async function fetchQuotes(projId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("quotes")
        .select(`
          *,
          items:quote_items(
            *,
            product:products!quote_items_product_id_fkey(
              id,
              product_name,
              list_price,
              cost_price
            )
          )
        `)
        .eq("project_id", projId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setQuotes(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createQuote(
    projectId: string,
    quoteName: string,
    items: Partial<QuoteItem>[],
    quoteData: Partial<Quote>
  ) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Generate quote number
      const quoteNumber = `QT-${Date.now()}`;
      
      // Calculate expiration date (3 months from now)
      const expirationDate = new Date();
      expirationDate.setMonth(expirationDate.getMonth() + 3);

      // Create quote
      const { data: quote, error: quoteError } = await supabase
        .from("quotes")
        .insert({
          project_id: projectId,
          user_id: user.id,
          quote_number: quoteNumber,
          quote_name: quoteName,
          expiration_date: expirationDate.toISOString().split('T')[0],
          ...quoteData,
        })
        .select()
        .single();

      if (quoteError) throw quoteError;

      // Create quote items
      if (items.length > 0 && quote) {
        const itemsWithQuoteId = items.map((item, index) => ({
          ...item,
          quote_id: quote.id,
          sort_order: index,
        }));

        const { data: createdItems, error: itemsError } = await supabase
          .from("quote_items")
          .insert(itemsWithQuoteId)
          .select();

        if (itemsError) throw itemsError;
        
        if (createdItems) {
          quote.items = createdItems;
        }
      }

      if (quote) {
        setQuotes([quote, ...quotes]);
      }
      return quote;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function updateQuoteStatus(id: string, status: Quote['status']) {
    try {
      const { data, error } = await supabase
        .from("quotes")
        .update({ status })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setQuotes(quotes.map((q) => (q.id === id ? { ...q, status } : q)));
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  return {
    quotes,
    loading,
    error,
    fetchQuotes,
    createQuote,
    updateQuoteStatus,
  };
}

