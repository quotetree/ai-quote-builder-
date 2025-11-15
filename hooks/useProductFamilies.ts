import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { ProductFamily } from "@/types/database";

export function useProductFamilies() {
  const [productFamilies, setProductFamilies] = useState<ProductFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchProductFamilies();
  }, []);

  async function fetchProductFamilies() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("product_families")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      setProductFamilies(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createProductFamily(name: string, description?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("product_families")
        .insert({
          user_id: user.id,
          name,
          description,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setProductFamilies([...productFamilies, data]);
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function updateProductFamily(id: string, updates: Partial<ProductFamily>) {
    try {
      const { data, error } = await supabase
        .from("product_families")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setProductFamilies(productFamilies.map((pf) => (pf.id === id ? data : pf)));
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function deleteProductFamily(id: string) {
    try {
      const { error: updateError } = await supabase
        .from("products")
        .update({ product_family_id: null })
        .eq("product_family_id", id);

      if (updateError) throw updateError;

      const { error } = await supabase
        .from("product_families")
        .delete()
        .eq("id", id);

      if (error) throw error;
      setProductFamilies(productFamilies.filter((pf) => pf.id !== id));
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  return {
    productFamilies,
    loading,
    error,
    fetchProductFamilies,
    createProductFamily,
    updateProductFamily,
    deleteProductFamily,
  };
}

