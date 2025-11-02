"use client";

import { useState } from "react";
import { X, Search, Plus, Upload, Edit, Trash2, ChevronDown, ExternalLink } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { useProductFamilies } from "@/hooks/useProductFamilies";
import { Product } from "@/types/database";
import { trackProductCreated, trackCsvUpload } from "@/lib/analytics";
import toast from "react-hot-toast";
import Papa from "papaparse";
import Link from "next/link";

interface PriceBookModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = "list" | "new-product" | "csv-upload" | "csv-mapping";

export default function PriceBookModal({ isOpen, onClose }: PriceBookModalProps) {
  const { products, loading, createProduct, updateProduct, deleteProduct, bulkCreateProducts } = useProducts();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const filteredProducts = products.filter(
    (product) =>
      product.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.product_number?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCsvFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        setCsvHeaders(headers);
        setCsvData(results.data);

        // Auto-detect and map columns
        const autoMapping: Record<string, string> = {};
        headers.forEach((header) => {
          const lower = header.toLowerCase();
          if (lower.includes("name") && !lower.includes("family")) {
            autoMapping.product_name = header;
          } else if (lower.includes("number") || lower.includes("id") || lower.includes("sku") || lower.includes("code")) {
            autoMapping.product_number = header;
          } else if (lower.includes("brand") || lower.includes("manufacturer")) {
            autoMapping.product_brand = header;
          } else if (lower.includes("description") || lower.includes("desc")) {
            autoMapping.description = header;
          } else if (lower.includes("list") && lower.includes("price")) {
            autoMapping.list_price = header;
          } else if (lower.includes("sale") && lower.includes("price") || lower === "price") {
            autoMapping.sales_price = header;
          } else if (lower.includes("cost")) {
            autoMapping.cost_price = header;
          } else if (lower.includes("family") || lower.includes("category")) {
            autoMapping.product_family = header;
          } else if (lower.includes("type")) {
            autoMapping.product_type = header;
          } else if (lower.includes("unit")) {
            autoMapping.unit = header;
          }
        });

        setColumnMapping(autoMapping);
        setViewMode("csv-mapping");
      },
      error: () => {
        toast.error("Failed to parse CSV file");
      },
    });

    event.target.value = "";
  };

  const handleCsvImport = async () => {
    try {
      const productsData = csvData
        .filter((row) => row[columnMapping.product_name])
        .map((row) => ({
          product_number: columnMapping.product_number ? row[columnMapping.product_number] : null,
          product_name: row[columnMapping.product_name],
          product_brand: columnMapping.product_brand ? row[columnMapping.product_brand] : null,
          description: columnMapping.description ? row[columnMapping.description] : null,
          list_price: parseFloat(row[columnMapping.list_price] || 0),
          sales_price: parseFloat(row[columnMapping.sales_price] || row[columnMapping.list_price] || 0),
          cost_price: columnMapping.cost_price ? parseFloat(row[columnMapping.cost_price] || 0) : 0,
          product_type: columnMapping.product_type ? row[columnMapping.product_type] : null,
          unit: columnMapping.unit ? row[columnMapping.unit] : "ea",
        }));

      await bulkCreateProducts(productsData);
      await trackCsvUpload(csvData.length, productsData.length);
      toast.success(`Imported ${productsData.length} products`);
      setViewMode("list");
      setCsvData([]);
      setCsvHeaders([]);
      setColumnMapping({});
    } catch (error: any) {
      toast.error(error.message || "Failed to import products");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-4 flex-1">
            <h2 className="text-2xl font-bold text-gray-900">Price Book</h2>
            {viewMode === "list" && (
              <div className="flex-1 max-w-md relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Action Bar */}
        {viewMode === "list" && (
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-gray-50">
            <button
              onClick={() => setViewMode("new-product")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2 font-medium"
            >
              <Plus size={18} />
              New Product
            </button>
            <label className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors inline-flex items-center gap-2 font-medium cursor-pointer">
              <Upload size={18} />
              Upload CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvFileSelect}
                className="hidden"
              />
            </label>
            <div className="flex-1" />
            <span className="text-sm text-gray-600">
              {products.length} {products.length === 1 ? "product" : "products"}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {viewMode === "list" && (
            <ProductsTable
              products={filteredProducts}
              loading={loading}
              onEdit={(product) => {
                setEditingProduct(product);
                setViewMode("new-product");
              }}
              onDelete={async (productId) => {
                if (confirm("Are you sure you want to delete this product?")) {
                  try {
                    await deleteProduct(productId);
                    toast.success("Product deleted");
                  } catch (error) {
                    toast.error("Failed to delete product");
                  }
                }
              }}
            />
          )}

          {viewMode === "new-product" && (
            <ProductForm
              product={editingProduct}
              onCancel={() => {
                setViewMode("list");
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
                  setViewMode("list");
                  setEditingProduct(null);
                } catch (error: any) {
                  toast.error(error.message || "Failed to save product");
                }
              }}
            />
          )}

          {viewMode === "csv-mapping" && (
            <CsvColumnMapping
              headers={csvHeaders}
              mapping={columnMapping}
              onMappingChange={setColumnMapping}
              sampleData={csvData[0] || {}}
              onCancel={() => {
                setViewMode("list");
                setCsvData([]);
                setCsvHeaders([]);
                setColumnMapping({});
              }}
              onImport={handleCsvImport}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Products Table Component
function ProductsTable({
  products,
  loading,
  onEdit,
  onDelete,
}: {
  products: Product[];
  loading: boolean;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading products...</p>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-6xl mb-4">📦</div>
          <p className="text-gray-600 mb-2 font-medium">No products found</p>
          <p className="text-sm text-gray-500">Add products to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Product Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Product Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Description
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              List Price
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Sales Price
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {products.map((product) => (
            <tr key={product.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-6 py-4">
                <div className="flex flex-col">
                  <button
                    className="text-blue-600 hover:text-blue-800 font-medium text-left inline-flex items-center gap-1"
                    onClick={() => {
                      // Navigate to product detail page
                      window.open(`/pricebook/${product.id}`, "_blank");
                    }}
                  >
                    {product.product_name}
                    <ExternalLink size={14} />
                  </button>
                  {product.product_number && (
                    <span className="text-xs text-gray-500">#{product.product_number}</span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-gray-900">
                {product.product_type || "—"}
              </td>
              <td className="px-6 py-4">
                <p className="text-sm text-gray-600 line-clamp-2 max-w-md">
                  {product.description || "—"}
                </p>
              </td>
              <td className="px-6 py-4 text-sm text-gray-900">
                ${product.list_price.toLocaleString()}
              </td>
              <td className="px-6 py-4 text-sm font-medium text-blue-600">
                ${product.sales_price.toLocaleString()}
              </td>
              <td className="px-6 py-4 text-right relative">
                <button
                  onClick={() => setExpandedRow(expandedRow === product.id ? null : product.id)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors inline-flex items-center gap-1"
                >
                  <ChevronDown
                    size={16}
                    className={`transition-transform ${expandedRow === product.id ? "rotate-180" : ""}`}
                  />
                </button>
                {expandedRow === product.id && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setExpandedRow(null)}
                    />
                    <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                      <button
                        onClick={() => {
                          onEdit(product);
                          setExpandedRow(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                      >
                        <Edit size={16} />
                        Edit Product
                      </button>
                      <button
                        onClick={() => {
                          onDelete(product.id);
                          setExpandedRow(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <Trash2 size={16} />
                        Delete Product
                      </button>
                    </div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Product Form Component
function ProductForm({
  product,
  onCancel,
  onSave,
}: {
  product: Product | null;
  onCancel: () => void;
  onSave: (data: Partial<Product>) => void;
}) {
  const { productFamilies, loading: familiesLoading } = useProductFamilies();
  const [formData, setFormData] = useState({
    product_number: product?.product_number || "",
    product_name: product?.product_name || "",
    product_brand: product?.product_brand || "",
    product_type: product?.product_type || "",
    product_family_id: product?.product_family_id || "",
    description: product?.description || "",
    list_price: product?.list_price || 0,
    sales_price: product?.sales_price || 0,
    unit: product?.unit || "ea",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    if (!formData.product_name) {
      toast.error("Product Name is required");
      return;
    }
    if (!formData.product_number) {
      toast.error("Product Code is required");
      return;
    }
    if (!formData.product_family_id) {
      toast.error("Product Family is required");
      return;
    }
    if (!formData.list_price || formData.list_price <= 0) {
      toast.error("List Price is required");
      return;
    }
    if (!formData.sales_price || formData.sales_price <= 0) {
      toast.error("Sales Price is required");
      return;
    }
    
    onSave(formData);
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="mb-8">
        <h3 className="text-xl font-bold text-gray-900 mb-1">Product Information</h3>
        <p className="text-sm text-gray-500">* = Required information</p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Product Name and Product Code */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Product Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.product_name}
              onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Product Code <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.product_number}
              onChange={(e) => setFormData({ ...formData, product_number: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
        </div>

        {/* Product Brand and Product Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Product Brand
            </label>
            <input
              type="text"
              value={formData.product_brand}
              onChange={(e) => setFormData({ ...formData, product_brand: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Product Type
            </label>
            <input
              type="text"
              value={formData.product_type}
              onChange={(e) => setFormData({ ...formData, product_type: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Product Family */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Product Family <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              value={formData.product_family_id}
              onChange={(e) => setFormData({ ...formData, product_family_id: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
              required
              disabled={familiesLoading}
            >
              <option value="">Select a product family</option>
              {productFamilies.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={4}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Product details..."
          />
        </div>

        {/* List Price and Sales Price */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              List Price <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.list_price}
              onChange={(e) => setFormData({ ...formData, list_price: parseFloat(e.target.value) || 0 })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sales Price <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.sales_price}
              onChange={(e) => setFormData({ ...formData, sales_price: parseFloat(e.target.value) || 0 })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-6">
          <button
            type="submit"
            className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            {product ? "Update Product" : "Create Product"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-8 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// CSV Column Mapping Component
function CsvColumnMapping({
  headers,
  mapping,
  onMappingChange,
  sampleData,
  onCancel,
  onImport,
}: {
  headers: string[];
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  sampleData: Record<string, any>;
  onCancel: () => void;
  onImport: () => void;
}) {
  const requiredFields = [
    { key: "product_name", label: "Product Name", required: true },
    { key: "list_price", label: "List Price", required: true },
    { key: "sales_price", label: "Sales Price", required: true },
  ];

  const optionalFields = [
    { key: "product_number", label: "Product Code", required: false },
    { key: "product_brand", label: "Product Brand", required: false },
    { key: "product_type", label: "Product Type", required: false },
    { key: "description", label: "Description", required: false },
    { key: "cost_price", label: "Cost Price", required: false },
    { key: "unit", label: "Unit", required: false },
  ];

  const allFields = [...requiredFields, ...optionalFields];

  const isValid = requiredFields.every((field) => mapping[field.key]);

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="mb-6">
        <h3 className="text-xl font-bold mb-2">Map CSV Columns</h3>
        <p className="text-gray-600">
          Match your CSV columns to our product fields. We've auto-detected some mappings for you.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>Preview:</strong> First row from your CSV
        </p>
      </div>

      <div className="space-y-4">
        {allFields.map((field) => (
          <div key={field.key} className="grid grid-cols-3 gap-4 items-center">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
            </div>
            <div>
              <select
                value={mapping[field.key] || ""}
                onChange={(e) => {
                  onMappingChange({
                    ...mapping,
                    [field.key]: e.target.value,
                  });
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">-- Select Column --</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {mapping[field.key] && (
                <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded border border-gray-200 truncate">
                  {sampleData[mapping[field.key]] || <span className="text-gray-400">empty</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {!isValid && (
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> Please map all required fields (marked with *) before importing.
          </p>
        </div>
      )}

      <div className="flex gap-3 pt-8">
        <button
          onClick={onImport}
          disabled={!isValid}
          className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
        >
          Import Products
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

