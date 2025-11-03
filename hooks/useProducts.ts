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
      
      // First get the total count in the database
      const { count: totalCount } = await supabase
        .from("products")
        .select("*", { count: "exact", head: true });
      
      console.log(`📊 DATABASE COUNT: ${totalCount} products in database`);
      
      // Fetch ALL products using pagination (bypass 1000 limit)
      const pageSize = 1000;
      let allProducts: Product[] = [];
      let currentPage = 0;
      let hasMore = true;

      while (hasMore) {
        const from = currentPage * pageSize;
        const to = from + pageSize - 1;
        
        console.log(`   📄 Fetching page ${currentPage + 1} (rows ${from}-${to})...`);
        
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .order("product_name", { ascending: true })
          .range(from, to);

        if (error) throw error;
        
        if (data && data.length > 0) {
          allProducts = [...allProducts, ...data];
          console.log(`   ✅ Got ${data.length} products (total so far: ${allProducts.length})`);
          
          // Check if we got less than a full page (means we're done)
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            currentPage++;
          }
        } else {
          hasMore = false;
        }
      }
      
      console.log(`✅ FETCHED ALL: ${allProducts.length} of ${totalCount} products`);
      
      if (totalCount && allProducts.length !== totalCount) {
        console.warn(`⚠️ Expected ${totalCount} but got ${allProducts.length}`);
      }
      
      setProducts(allProducts);
    } catch (err: any) {
      console.error(`❌ FETCH ERROR:`, err);
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

      console.log(`🚀 BULK IMPORT STARTED: ${productsData.length} products to import`);

      // Fetch existing products to check for duplicates
      const { data: existingProducts } = await supabase
        .from("products")
        .select("product_number, product_name")
        .eq("user_id", user.id)
        .limit(10000);

      console.log(`📊 Found ${existingProducts?.length || 0} existing products in database`);

      // Create Sets for efficient duplicate checking
      const existingProductNumbers = new Set(
        existingProducts?.filter(p => p.product_number).map(p => p.product_number) || []
      );
      const existingProductNames = new Set(
        existingProducts?.map(p => p.product_name.toLowerCase()) || []
      );

      console.log(`   ${existingProductNumbers.size} unique product numbers`);
      console.log(`   ${existingProductNames.size} unique product names`);

      // Filter out duplicates
      let skippedCount = 0;
      const newProducts = productsData.filter((p) => {
        const isDuplicateByNumber = p.product_number && existingProductNumbers.has(p.product_number);
        const isDuplicateByName = p.product_name && existingProductNames.has(p.product_name.toLowerCase());
        
        if (isDuplicateByNumber || isDuplicateByName) {
          skippedCount++;
          return false;
        }
        return true;
      });

      console.log(`✅ After deduplication: ${newProducts.length} new products, ${skippedCount} duplicates skipped`);

      if (newProducts.length === 0) {
        console.log(`⚠️ NO NEW PRODUCTS TO IMPORT - all were duplicates!`);
        await fetchProducts();
        return {
          inserted: [],
          skipped: skippedCount,
          total: productsData.length
        };
      }

      const productsWithUserId = newProducts.map((p) => ({
        ...p,
        user_id: user.id,
      }));

      // Batch inserts to handle 1000+ products (Supabase limit ~1000 per insert)
      const batchSize = 1000;
      let allInsertedData: Product[] = [];
      const totalBatches = Math.ceil(productsWithUserId.length / batchSize);

      console.log(`📦 Starting batch insert: ${productsWithUserId.length} products in ${totalBatches} batch(es)`);

      for (let i = 0; i < productsWithUserId.length; i += batchSize) {
        const batch = productsWithUserId.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        
        console.log(`   ⏳ Batch ${batchNum}/${totalBatches}: Inserting ${batch.length} products...`);
        
        const { data, error } = await supabase
          .from("products")
          .insert(batch)
          .select();

        if (error) {
          console.error(`   ❌ Batch ${batchNum} ERROR:`, error);
          throw error;
        }
        
        if (data) {
          allInsertedData = [...allInsertedData, ...data];
          console.log(`   ✅ Batch ${batchNum}/${totalBatches}: Successfully inserted ${data.length} products`);
        }
      }

      console.log(`✅ BULK IMPORT COMPLETE: ${allInsertedData.length} products inserted`);

      // Refresh products from database
      console.log(`🔄 Refreshing product list from database...`);
      await fetchProducts();
      
      return {
        inserted: allInsertedData,
        skipped: skippedCount,
        total: productsData.length
      };
    } catch (err: any) {
      console.error(`❌ BULK IMPORT FAILED:`, err);
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

