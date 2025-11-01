import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Product } from "@/types/database";

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchProducts();
  }, []);

  async function fetchProducts() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("product_name", { ascending: true });

      if (error) throw error;
      setProducts(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createProduct(product: Partial<Product>) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("products")
        .insert({
          ...product,
          user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setProducts([...products, data]);
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function updateProduct(id: string, updates: Partial<Product>) {
    try {
      const { data, error } = await supabase
        .from("products")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setProducts(products.map((p) => (p.id === id ? data : p)));
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function deleteProduct(id: string) {
    try {
      const { error } = await supabase.from("products").delete().eq("id", id);

      if (error) throw error;
      setProducts(products.filter((p) => p.id !== id));
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  async function bulkCreateProducts(productsData: Partial<Product>[]) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const productsWithUserId = productsData.map((p) => ({
        ...p,
        user_id: user.id,
      }));

      const { data, error } = await supabase
        .from("products")
        .insert(productsWithUserId)
        .select();

      if (error) throw error;
      if (data) {
        setProducts([...products, ...data]);
      }
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }

  return {
    products,
    loading,
    error,
    fetchProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    bulkCreateProducts,
  };
}

