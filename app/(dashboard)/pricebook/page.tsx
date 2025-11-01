"use client";

import { useState } from "react";
import { Search, Plus, Upload, X, Edit, Trash2 } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { Product } from "@/types/database";
import { trackProductCreated, trackCsvUpload } from "@/lib/analytics";
import toast from "react-hot-toast";
import Papa from "papaparse";

export default function PriceBookPage() {
  const { products, loading, createProduct, updateProduct, deleteProduct, bulkCreateProducts } = useProducts();
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showCsvUpload, setShowCsvUpload] = useState(false);

  const filteredProducts = products.filter(
    (product) =>
      product.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        try {
          const productsData = results.data
            .filter((row: any) => row.product_name)
            .map((row: any) => ({
              product_number: row.product_number || row.product_id || null,
              product_name: row.product_name || row.name,
              description: row.description || null,
              list_price: parseFloat(row.list_price || row.price || 0),
              sales_price: parseFloat(row.sales_price || row.sale_price || row.price || 0),
              cost_price: parseFloat(row.cost_price || row.cost || 0),
              unit: row.unit || "ea",
            }));

          await bulkCreateProducts(productsData);
          await trackCsvUpload(results.data.length, productsData.length);
          toast.success(`Imported ${productsData.length} products`);
          setShowCsvUpload(false);
        } catch (error: any) {
          toast.error(error.message || "Failed to import products");
        }
      },
      error: (error: any) => {
        toast.error("Failed to parse CSV file");
      },
    });

    event.target.value = "";
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Price Book</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Manage your products and pricing
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCsvUpload(true)}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors inline-flex items-center gap-2"
            >
              <Upload size={18} />
              Import CSV
            </button>
            <button
              onClick={() => setShowNewProduct(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              <Plus size={18} />
              New Product
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Products Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">Loading products...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
            <div className="text-6xl mb-4">📦</div>
            <p className="text-gray-600 dark:text-gray-400 mb-2">No products found</p>
            <p className="text-sm text-gray-500">Add products to your price book to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg truncate">{product.product_name}</h3>
                    {product.product_number && (
                      <p className="text-sm text-gray-500">#{product.product_number}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingProduct(product)}
                      className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm("Delete this product?")) {
                          try {
                            await deleteProduct(product.id);
                            toast.success("Product deleted");
                          } catch (error) {
                            toast.error("Failed to delete product");
                          }
                        }
                      }}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {product.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                    {product.description}
                  </p>
                )}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">List Price:</span>
                    <span className="font-semibold">${product.list_price.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Sales Price:</span>
                    <span className="font-semibold text-blue-600">${product.sales_price.toLocaleString()}</span>
                  </div>
                  {product.cost_price && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Cost:</span>
                      <span className="font-semibold text-green-600">${product.cost_price.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Product Form Modal */}
      {(showNewProduct || editingProduct) && (
        <ProductFormModal
          product={editingProduct}
          onClose={() => {
            setShowNewProduct(false);
            setEditingProduct(null);
          }}
          onSave={async (data) => {
            try {
              if (editingProduct) {
                await updateProduct(editingProduct.id, data);
                toast.success("Product updated");
              } else {
                const newProduct = await createProduct(data);
                if (newProduct) {
                  await trackProductCreated(newProduct.id, newProduct.product_name);
                }
                toast.success("Product created");
              }
              setShowNewProduct(false);
              setEditingProduct(null);
            } catch (error: any) {
              toast.error(error.message || "Failed to save product");
            }
          }}
        />
      )}

      {/* CSV Upload Modal */}
      {showCsvUpload && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Import Products from CSV</h3>
              <button onClick={() => setShowCsvUpload(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400">
                Upload a CSV file with the following columns:
              </p>
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <code className="text-sm">
                  product_name, product_number, description, list_price, sales_price, cost_price, unit
                </code>
              </div>
              <label className="block">
                <span className="sr-only">Choose CSV file</span>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductFormModal({
  product,
  onClose,
  onSave,
}: {
  product: Product | null;
  onClose: () => void;
  onSave: (data: Partial<Product>) => void;
}) {
  const [formData, setFormData] = useState({
    product_number: product?.product_number || "",
    product_name: product?.product_name || "",
    description: product?.description || "",
    list_price: product?.list_price || 0,
    sales_price: product?.sales_price || 0,
    cost_price: product?.cost_price || 0,
    unit: product?.unit || "ea",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full">
        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
          <h3 className="text-xl font-bold">{product ? "Edit Product" : "New Product"}</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Product Number</label>
              <input
                type="text"
                value={formData.product_number}
                onChange={(e) => setFormData({ ...formData, product_number: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Product Name *</label>
              <input
                type="text"
                value={formData.product_name}
                onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">List Price *</label>
              <input
                type="number"
                step="0.01"
                value={formData.list_price}
                onChange={(e) => setFormData({ ...formData, list_price: parseFloat(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Sales Price *</label>
              <input
                type="number"
                step="0.01"
                value={formData.sales_price}
                onChange={(e) => setFormData({ ...formData, sales_price: parseFloat(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Cost Price</label>
              <input
                type="number"
                step="0.01"
                value={formData.cost_price}
                onChange={(e) => setFormData({ ...formData, cost_price: parseFloat(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Unit</label>
            <input
              type="text"
              value={formData.unit}
              onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
              placeholder="ea, ft, hr, etc."
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              {product ? "Update Product" : "Create Product"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

