import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Quote, QuoteItem } from "@/types/database";
import { updateProjectTimestamp } from "@/lib/updateProjectTimestamp";

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

      // Get all quotes for this project to determine next quote number
      const { data: projectQuotes, error: quotesError } = await supabase
        .from("quotes")
        .select("quote_number")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (quotesError) throw quotesError;

      // Find the highest quote number and increment
      let nextNumber = 1;
      if (projectQuotes && projectQuotes.length > 0) {
        const numbers = projectQuotes
          .map((q) => {
            const match = q.quote_number.match(/Q-(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter((n) => n > 0);
        
        if (numbers.length > 0) {
          nextNumber = Math.max(...numbers) + 1;
        }
      }

      // Generate quote number with leading zeros (Q-0001, Q-0002, etc.)
      const quoteNumber = `Q-${String(nextNumber).padStart(4, '0')}`;
      
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
        // Update project timestamp to mark as recently active
        await updateProjectTimestamp(projectId);
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
        // Update project timestamp to mark as recently active
        if (data.project_id) {
          await updateProjectTimestamp(data.project_id);
        }
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function updateQuote(id: string, quoteName: string) {
    try {
      const { data, error } = await supabase
        .from("quotes")
        .update({ quote_name: quoteName })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setQuotes(quotes.map((q) => (q.id === id ? { ...q, quote_name: quoteName } : q)));
        // Update project timestamp to mark as recently active
        if (data.project_id) {
          await updateProjectTimestamp(data.project_id);
        }
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function deleteQuote(id: string) {
    try {
      const { error } = await supabase
        .from("quotes")
        .delete()
        .eq("id", id);

      if (error) throw error;
      setQuotes(quotes.filter((q) => q.id !== id));
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function duplicateQuote(quoteId: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch the original quote with all its items
      const { data: originalQuote, error: fetchError } = await supabase
        .from("quotes")
        .select(`
          *,
          items:quote_items(*)
        `)
        .eq("id", quoteId)
        .single();

      if (fetchError) throw fetchError;
      if (!originalQuote) throw new Error("Quote not found");

      // Get all quotes for this project to determine next quote number
      const { data: projectQuotes, error: quotesError } = await supabase
        .from("quotes")
        .select("quote_number")
        .eq("project_id", originalQuote.project_id)
        .order("created_at", { ascending: false });

      if (quotesError) throw quotesError;

      // Find the highest quote number and increment
      let nextNumber = 1;
      if (projectQuotes && projectQuotes.length > 0) {
        const numbers = projectQuotes
          .map((q) => {
            const match = q.quote_number.match(/Q-(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter((n) => n > 0);
        
        if (numbers.length > 0) {
          nextNumber = Math.max(...numbers) + 1;
        }
      }

      // Generate new quote number with leading zeros (Q-0001, Q-0002, etc.)
      const quoteNumber = `Q-${String(nextNumber).padStart(4, '0')}`;
      
      // Create the duplicated quote with a new name
      const { data: newQuote, error: quoteError } = await supabase
        .from("quotes")
        .insert({
          project_id: originalQuote.project_id,
          user_id: user.id,
          quote_number: quoteNumber,
          quote_name: `${originalQuote.quote_name} - Copy`,
          version_number: 1,
          status: 'draft', // Always start as draft
          scope_of_work: originalQuote.scope_of_work,
          subtotal: originalQuote.subtotal,
          tax_rate: originalQuote.tax_rate,
          tax_amount: originalQuote.tax_amount,
          discount_rate: originalQuote.discount_rate,
          discount_amount: originalQuote.discount_amount,
          total_price: originalQuote.total_price,
          profit_margin: originalQuote.profit_margin,
          expiration_date: originalQuote.expiration_date,
          // Copy additional fields if they exist
          ...(originalQuote.baked_markups && { baked_markups: originalQuote.baked_markups }),
          ...(originalQuote.charges && { charges: originalQuote.charges }),
        })
        .select()
        .single();

      if (quoteError) throw quoteError;

      // Duplicate all quote items
      if (originalQuote.items && originalQuote.items.length > 0 && newQuote) {
        const itemsToInsert = originalQuote.items.map((item: any, index: number) => ({
          quote_id: newQuote.id,
          product_id: item.product_id,
          product_number: item.product_number,
          product_name: item.product_name,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percent: item.discount_percent,
          line_total: item.line_total,
          sort_order: index,
          // Copy additional fields if they exist
          ...(item.list_price && { list_price: item.list_price }),
          ...(item.cost_price && { cost_price: item.cost_price }),
          ...(item.metadata && { metadata: item.metadata }),
        }));

        const { data: createdItems, error: itemsError } = await supabase
          .from("quote_items")
          .insert(itemsToInsert)
          .select();

        if (itemsError) throw itemsError;
        
        if (createdItems) {
          newQuote.items = createdItems;
        }
      }

      // Refresh quotes list to include the new duplicate
      if (projectId) {
        await fetchQuotes(projectId);
        // Update project timestamp to mark as recently active
        await updateProjectTimestamp(projectId);
      }

      return newQuote;
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
    updateQuote,
    deleteQuote,
    duplicateQuote,
  };
}

