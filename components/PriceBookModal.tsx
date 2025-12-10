"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { X, Search, Plus, Upload, Edit, Trash2, ChevronDown, Download, Lock } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { useProductFamilies } from "@/hooks/useProductFamilies";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";
import { Product, ProductFamily } from "@/types/database";
import { trackProductCreated, trackCsvUpload } from "@/lib/analytics";
import toast from "react-hot-toast";
import Papa from "papaparse";
import Link from "next/link";

interface PriceBookModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = "list" | "new-product" | "csv-upload" | "csv-mapping" | "product-detail";

const NONE_PRODUCT_FAMILY_LABEL = "-None-";

export default function PriceBookModal({ isOpen, onClose }: PriceBookModalProps) {
  const {
    products,
    loading,
    fetchProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    deleteProducts,
    bulkCreateProducts,
  } = useProducts();
  const {
    productFamilies,
    loading: productFamiliesLoading,
    createProductFamily,
    updateProductFamily,
    deleteProductFamily,
  } = useProductFamilies();
  const { canManagePriceBook, hasReadOnlyPriceBook } = useOrganizationRole();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showFamilyManager, setShowFamilyManager] = useState(false);
  const [showUnmappedWarning, setShowUnmappedWarning] = useState(false);
  const [unmappedColumnsCount, setUnmappedColumnsCount] = useState(0);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const productFamilyNameMap = useMemo(() => {
    const map = new Map<string, string>();
    productFamilies.forEach((family) => {
      if (family?.id) {
        map.set(family.id, family.name);
      }
    });
    return map;
  }, [productFamilies]);

  const getFamilyDisplayName = useCallback(
    (familyId: string | null | undefined) => {
      if (familyId && productFamilyNameMap.has(familyId)) {
        return productFamilyNameMap.get(familyId) || NONE_PRODUCT_FAMILY_LABEL;
      }
      return NONE_PRODUCT_FAMILY_LABEL;
    },
    [productFamilyNameMap]
  );

  useEffect(() => {
    if (!isOpen) {
      setSelectedProductIds([]);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedProductIds((prev) =>
      prev.filter((id) => products.some((product) => product.id === id))
    );
  }, [products]);

  // Improved search filtering with useMemo for performance and consistency
  // MUST be called before the early return to follow Rules of Hooks
  const filteredProducts = useMemo(() => {
    // If no search query, return all products
    if (!searchQuery || searchQuery.trim() === "") {
      return products;
    }

    // Split search query into individual words and normalize
    // "cat6 cable" becomes ["cat6", "cable"]
    const searchTerms = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/) // Split on whitespace
      .filter(term => term.length > 0);

    if (searchTerms.length === 0) {
      return products;
    }
    
    const filtered = products.filter((product) => {
      // Combine all searchable fields into one string for easier matching
      const searchableText = [
        product.product_name,
        product.product_number,
        product.description,
        product.product_brand,
        product.product_type,
        ...(product.product_tags || [])
      ]
        .filter(Boolean) // Remove null/undefined
        .join(' ') // Join with space
        .toLowerCase();

      // ALL search terms must be found somewhere in the searchable text
      // "cat6 cable" will match if BOTH "cat6" AND "cable" appear anywhere
      return searchTerms.every(term => searchableText.includes(term));
    });

    // Debug logging
    console.log(`🔍 Search for "${searchQuery}" (${searchTerms.length} terms): Found ${filtered.length} of ${products.length} products`);
    
    return filtered;
  }, [products, searchQuery]);

  const visibleProductIds = useMemo(
    () => filteredProducts.map((product) => product.id),
    [filteredProducts]
  );
  const allVisibleSelected =
    visibleProductIds.length > 0 &&
    visibleProductIds.every((id) => selectedProductIds.includes(id));
  const anyVisibleSelected = visibleProductIds.some((id) =>
    selectedProductIds.includes(id)
  );
  const indeterminateSelection = anyVisibleSelected && !allVisibleSelected;

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const handleToggleSelectAll = () => {
    setSelectedProductIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleProductIds.includes(id));
      }

      const next = new Set(prev);
      visibleProductIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const handleDeleteSelected = async () => {
    if (!selectedProductIds.length) return;

    const idsToDelete = [...selectedProductIds];
    const confirmMessage =
      idsToDelete.length === 1
        ? "Are you sure you want to delete this product?"
        : `Are you sure you want to delete ${idsToDelete.length} selected products?`;

    if (!confirm(confirmMessage)) return;

    setBulkDeleteLoading(true);
    try {
      await deleteProducts(idsToDelete);
      toast.success(
        `${idsToDelete.length} product${
          idsToDelete.length === 1 ? "" : "s"
        } deleted`
      );
      setSelectedProductIds([]);
    } catch (error) {
      console.error("Failed to delete selected products", error);
      toast.error("Failed to delete selected products");
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const deleteFamilyAndRefresh = useCallback(
    async (familyId: string) => {
      await deleteProductFamily(familyId);
      await fetchProducts();
    },
    [deleteProductFamily, fetchProducts]
  );

  const handleExportSelected = () => {
    if (!selectedProductIds.length) return;

    const selectedProducts = products.filter((product) =>
      selectedProductIds.includes(product.id)
    );

    if (!selectedProducts.length) {
      toast.error("No products selected for export");
      return;
    }

    const headers = [
      "Product Name",
      "Product Code",
      "Product Family",
      "Product Brand",
      "Product Type",
      "List Price",
      "Sales Price",
      "Product Description",
    ];

    const escapeCsvValue = (value: string | number | null | undefined) => {
      if (value === null || value === undefined) return "";
      const stringValue = String(value).replace(/"/g, '""');
      return /[",\n]/.test(stringValue) ? `"${stringValue}"` : stringValue;
    };

    const rows = selectedProducts.map((product) => [
      product.product_name,
      product.product_number,
      getFamilyDisplayName(product.product_family_id),
      product.product_brand,
      product.product_type,
      product.list_price,
      product.sales_price,
      product.description,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map(escapeCsvValue).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    link.href = url;
    link.download = `products-export-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(
      `${selectedProducts.length} product${
        selectedProducts.length === 1 ? "" : "s"
      } exported`
    );
  };

  if (!isOpen) return null;

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
          } else if (lower.includes("family") || lower.includes("category")) {
            autoMapping.product_family = header;
          } else if (lower.includes("type")) {
            autoMapping.product_type = header;
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

  const handleCsvImportClick = () => {
    // Define which fields are optional in the pricebook
    const optionalFields = ['product_family', 'product_number', 'product_brand', 'product_type', 'description'];
    
    // Find which optional fields are NOT mapped (check for both undefined and empty string)
    const unmappedOptionalFields = optionalFields.filter(field => !columnMapping[field] || columnMapping[field] === '');
    
    // Show warning if there are unmapped optional fields
    if (unmappedOptionalFields.length > 0) {
      setUnmappedColumnsCount(unmappedOptionalFields.length);
      setShowUnmappedWarning(true);
    } else {
      handleCsvImport();
    }
  };

  const handleCsvImport = async () => {
    // Close the warning dialog if it was open
    setShowUnmappedWarning(false);
    
    try {
      // Helper function to safely parse numbers
      const safeParseFloat = (value: any, defaultValue: number = 0): number => {
        if (value === null || value === undefined || value === '') return defaultValue;
        const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
        return isNaN(parsed) ? defaultValue : parsed;
      };

      // Helper function to normalize text for comparison
      const normalizeText = (text: string): string => {
        return text.toLowerCase().trim().replace(/\s+/g, ' ');
      };

      // Helper function to get singular form (simple implementation)
      const toSingular = (text: string): string => {
        const normalized = normalizeText(text);
        if (normalized.endsWith('ies')) {
          return normalized.slice(0, -3) + 'y';
        }
        if (normalized.endsWith('ses') || normalized.endsWith('ches') || normalized.endsWith('xes')) {
          return normalized.slice(0, -2);
        }
        if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
          return normalized.slice(0, -1);
        }
        return normalized;
      };

      // Track newly created families during this import to prevent duplicates
      const newlyCreatedFamilies: Array<{ id: string; name: string }> = [];

      // Helper function to find or create product family
      const findOrCreateFamilyId = async (familyName: string | null): Promise<string | null> => {
        if (!familyName || !familyName.trim()) return null;
        
        const normalizedInput = normalizeText(familyName);
        const singularInput = toSingular(normalizedInput);
        
        // Check existing product families
        let match = productFamilies.find(
          (f) => normalizeText(f.name) === normalizedInput
        );
        
        // Try singular/plural variations in existing families
        if (!match) {
          match = productFamilies.find(
            (f) => toSingular(normalizeText(f.name)) === singularInput
          );
        }
        
        if (match) {
          console.log(`✅ Found existing family: "${familyName}" → "${match.name}"`);
          return match.id;
        }
        
        // Check newly created families from this import session
        const newMatch = newlyCreatedFamilies.find(
          (f) => normalizeText(f.name) === normalizedInput || toSingular(normalizeText(f.name)) === singularInput
        );
        
        if (newMatch) {
          console.log(`✅ Using newly created family: "${familyName}" → "${newMatch.name}"`);
          return newMatch.id;
        }
        
        // No match found - create new family with proper capitalization
        // Use the original input but trim and clean up spaces
        const cleanName = familyName.trim().replace(/\s+/g, ' ');
        try {
          console.log(`🆕 Creating new family: "${cleanName}"`);
          const newFamily = await createProductFamily(cleanName, `Imported from CSV`);
          if (newFamily) {
            newlyCreatedFamilies.push({ id: newFamily.id, name: newFamily.name });
            return newFamily.id;
          }
          return null;
        } catch (error) {
          console.error(`Failed to create family "${cleanName}":`, error);
          return null;
        }
      };

      // Collect unique family names from CSV (normalize to avoid duplicates)
      const uniqueFamilyNamesMap = new Map<string, string>(); // normalized -> original
      csvData.forEach((row) => {
        if (columnMapping.product_family && row[columnMapping.product_family]) {
          const original = row[columnMapping.product_family].trim();
          const normalized = toSingular(normalizeText(original));
          
          // Only add if we haven't seen this normalized version
          if (!uniqueFamilyNamesMap.has(normalized)) {
            uniqueFamilyNamesMap.set(normalized, original);
          }
        }
      });

      const uniqueFamilyNames = Array.from(uniqueFamilyNamesMap.values());
      
      // Create/find all families first
      toast.loading(`Processing ${uniqueFamilyNames.length} product families...`);
      const familyIdMap = new Map<string, string | null>(); // normalized -> familyId
      
      for (const familyName of uniqueFamilyNames) {
        const familyId = await findOrCreateFamilyId(familyName);
        const normalized = toSingular(normalizeText(familyName));
        familyIdMap.set(normalized, familyId);
      }

      toast.dismiss();
      
      // Now process all products
      const productsData = csvData
        .filter((row) => row[columnMapping.product_name])
        .map((row) => {
          const listPrice = safeParseFloat(row[columnMapping.list_price], 0);
          const salesPrice = safeParseFloat(
            row[columnMapping.sales_price] || row[columnMapping.list_price],
            listPrice
          );
          
          // Get family ID from our map using normalized key
          const familyName = columnMapping.product_family ? row[columnMapping.product_family]?.trim() : null;
          const normalizedFamilyKey = familyName ? toSingular(normalizeText(familyName)) : null;
          const familyId = normalizedFamilyKey ? familyIdMap.get(normalizedFamilyKey) || null : null;
          
          return {
          product_number: columnMapping.product_number ? row[columnMapping.product_number] : null,
          product_name: row[columnMapping.product_name],
            product_brand: columnMapping.product_brand ? row[columnMapping.product_brand] : null,
            product_family_id: familyId || null,
          description: columnMapping.description ? row[columnMapping.description] : null,
            list_price: listPrice,
            sales_price: salesPrice,
            cost_price: 0, // Default to 0 for CSV imports
          product_type: columnMapping.product_type ? row[columnMapping.product_type] : null,
            unit: "ea", // Default to "ea" for CSV imports
          };
        });

      // Validate that we have products to import
      if (productsData.length === 0) {
        toast.error("No valid products found to import");
        return;
      }

      // Validate that all products have required fields
      const invalidProducts = productsData.filter(
        (p) => !p.product_name || p.list_price === null || p.sales_price === null
      );

      if (invalidProducts.length > 0) {
        toast.error(`${invalidProducts.length} products are missing required fields (name, product family, list price, or sales price)`);
        return;
      }

      const result = await bulkCreateProducts(productsData);
      await trackCsvUpload(csvData.length, productsData.length);
      
      // Count how many new families were created
      const existingFamilyCount = productFamilies.length;
      const newFamiliesCreated = Math.max(0, uniqueFamilyNames.length - Array.from(familyIdMap.values()).filter(id => 
        productFamilies.some(f => f.id === id)
      ).length);
      
      let successMessage = `Successfully imported ${result.inserted.length} new products`;
      if (result.skipped > 0) {
        successMessage += ` (${result.skipped} duplicates skipped)`;
      }
      if (newFamiliesCreated > 0) {
        successMessage += ` and created ${newFamiliesCreated} new product ${newFamiliesCreated === 1 ? 'family' : 'families'}`;
      }
      
      toast.success(successMessage, { duration: 5000 });
      setViewMode("list");
      setCsvData([]);
      setCsvHeaders([]);
      setColumnMapping({});
    } catch (error: any) {
      console.error("CSV Import Error:", error);
      toast.error(error.message || "Failed to import products. Please check your data and try again.");
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
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
            {hasReadOnlyPriceBook() && (
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <Lock size={16} className="text-blue-600" />
                <span className="text-sm text-blue-700 font-medium">Read-Only Access</span>
              </div>
            )}
            {canManagePriceBook() && (
              <>
                <button
                  onClick={() => setViewMode("new-product")}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors inline-flex items-center gap-2 font-medium"
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
                <button
                  onClick={() => setShowFamilyManager(true)}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors inline-flex items-center gap-2 font-medium"
                >
                  Manage Families
                </button>
              </>
            )}
            {selectedProductIds.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportSelected}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors inline-flex items-center gap-2 font-medium"
                >
                  <Download size={18} />
                  Export
                </button>
                {canManagePriceBook() && (
                  <button
                    onClick={handleDeleteSelected}
                    disabled={bulkDeleteLoading}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors inline-flex items-center gap-2 font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={18} />
                    {bulkDeleteLoading
                      ? "Deleting..."
                      : `Delete Selected (${selectedProductIds.length})`}
                  </button>
                )}
              </div>
            )}
            <div className="flex-1" />
            <span className="text-sm text-gray-600">
              {searchQuery ? (
                <>Showing {filteredProducts.length} of {products.length} products</>
              ) : (
                <>{products.length} {products.length === 1 ? "product" : "products"}</>
              )}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {viewMode === "list" && (
            <ProductsTable
              products={filteredProducts}
              loading={loading}
              productFamilies={productFamilies}
              canManagePriceBook={canManagePriceBook()}
              onView={(product) => {
                setViewingProduct(product);
                setViewMode("product-detail");
              }}
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
              selectedProductIds={selectedProductIds}
              onToggleProductSelection={toggleProductSelection}
              onToggleSelectAll={handleToggleSelectAll}
              isAllVisibleSelected={allVisibleSelected}
              isSomeVisibleSelected={indeterminateSelection}
            />
          )}

          {viewMode === "new-product" && (
            <ProductForm
              product={editingProduct}
            productFamilies={productFamilies}
            familiesLoading={productFamiliesLoading}
            onCreateFamily={createProductFamily}
            onDeleteFamily={deleteFamilyAndRefresh}
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
              productFamilies={productFamilies}
              onCancel={() => {
                setViewMode("list");
                setCsvData([]);
                setCsvHeaders([]);
                setColumnMapping({});
              }}
              onImport={handleCsvImportClick}
            />
          )}

          {viewMode === "product-detail" && viewingProduct && (
            <ProductDetail
              product={viewingProduct}
              productFamilies={productFamilies}
              onBack={() => {
                setViewingProduct(null);
                setViewMode("list");
              }}
              onEdit={() => {
                setEditingProduct(viewingProduct);
                setViewMode("new-product");
              }}
              onDelete={async () => {
                if (confirm("Are you sure you want to delete this product?")) {
                  try {
                    await deleteProduct(viewingProduct.id);
                    toast.success("Product deleted");
                    setViewingProduct(null);
                    setViewMode("list");
                  } catch (error) {
                    toast.error("Failed to delete product");
                  }
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Product Family Manager Modal */}
      {showFamilyManager && (
        <ProductFamilyManager
          productFamilies={productFamilies}
          products={products}
          onClose={() => setShowFamilyManager(false)}
          onUpdate={updateProductFamily}
          onDelete={deleteFamilyAndRefresh}
        />
      )}

      {/* Unmapped Columns Warning Modal */}
      {showUnmappedWarning && (
        <UnmappedColumnsWarning
          unmappedCount={unmappedColumnsCount}
          onCancel={() => setShowUnmappedWarning(false)}
          onConfirm={handleCsvImport}
        />
      )}
    </div>
  );
}

// Products Table Component
function ProductsTable({
  products,
  loading,
  onView,
  onEdit,
  onDelete,
  productFamilies,
  canManagePriceBook,
  selectedProductIds,
  onToggleProductSelection,
  onToggleSelectAll,
  isAllVisibleSelected,
  isSomeVisibleSelected,
}: {
  products: Product[];
  loading: boolean;
  onView: (product: Product) => void;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  productFamilies: ProductFamily[];
  canManagePriceBook: boolean;
  selectedProductIds: string[];
  onToggleProductSelection: (productId: string) => void;
  onToggleSelectAll: () => void;
  isAllVisibleSelected: boolean;
  isSomeVisibleSelected: boolean;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isSomeVisibleSelected;
    }
  }, [isSomeVisibleSelected, isAllVisibleSelected]);

  const getFamilyName = (familyId: string | null) => {
    if (!familyId) return NONE_PRODUCT_FAMILY_LABEL;
    const family = productFamilies.find((f) => f.id === familyId);
    return family ? family.name : NONE_PRODUCT_FAMILY_LABEL;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
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
            <th className="px-4 py-3 w-12">
              <input
                type="checkbox"
                ref={selectAllRef}
                checked={isAllVisibleSelected}
                onChange={onToggleSelectAll}
                className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                aria-label="Select all products"
              />
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Product Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Product Family
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
              <td className="px-4 py-4 w-12 align-top">
                <input
                  type="checkbox"
                  checked={selectedProductIds.includes(product.id)}
                  onChange={() => onToggleProductSelection(product.id)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  aria-label={`Select product ${product.product_name}`}
                />
              </td>
              <td className="px-6 py-4">
                <div className="flex flex-col">
                  <button
                    className="text-green-600 hover:text-green-800 font-medium text-left"
                    onClick={() => onView(product)}
                  >
                    {product.product_name}
                  </button>
                  {product.product_number && (
                    <span className="text-xs text-gray-500">#{product.product_number}</span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-gray-900">
                {getFamilyName(product.product_family_id)}
              </td>
              <td className="px-6 py-4">
                <p className="text-sm text-gray-600 line-clamp-2 max-w-md">
                  {product.description || "—"}
                </p>
              </td>
              <td className="px-6 py-4 text-sm text-gray-900">
                ${product.list_price.toLocaleString()}
              </td>
              <td className="px-6 py-4 text-sm font-medium text-green-600">
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
                    <div className="absolute right-0 bottom-full -mb-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                      {canManagePriceBook ? (
                        <>
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
                        </>
                      ) : (
                        <div className="px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                          <Lock size={14} />
                          <span>Read-only access</span>
                        </div>
                      )}
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
  productFamilies,
  familiesLoading,
  onCreateFamily,
  onDeleteFamily,
}: {
  product: Product | null;
  onCancel: () => void;
  onSave: (data: Partial<Product>) => void;
  productFamilies: ProductFamily[];
  familiesLoading: boolean;
  onCreateFamily: (name: string, description: string) => Promise<ProductFamily | null | undefined>;
  onDeleteFamily: (id: string) => Promise<void>;
}) {
  const [showFamilyModal, setShowFamilyModal] = useState(false);
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

  useEffect(() => {
    if (
      formData.product_family_id &&
      !productFamilies.some((family) => family.id === formData.product_family_id)
    ) {
      setFormData((prev) => ({ ...prev, product_family_id: "" }));
    }
  }, [formData.product_family_id, productFamilies]);

  const handleCreateFamily = async (name: string, description: string) => {
    try {
      const newFamily = await onCreateFamily(name, description);
      if (newFamily) {
        setFormData((prev) => ({ ...prev, product_family_id: newFamily.id }));
        toast.success("Product family created!");
        setShowFamilyModal(false);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create product family");
    }
  };

  const handleDeleteFamily = async () => {
    if (!formData.product_family_id) return;

    const family = productFamilies.find((f) => f.id === formData.product_family_id);
    const familyLabel = family?.name || "this product family";
    const confirmed = confirm(
      `Delete "${familyLabel}"?\n\nAll products assigned to it will be set to ${NONE_PRODUCT_FAMILY_LABEL}.`
    );

    if (!confirmed) return;

    try {
      await onDeleteFamily(formData.product_family_id);
      toast.success("Product family deleted");
      setFormData((prev) => ({ ...prev, product_family_id: "" }));
    } catch (error: any) {
      toast.error(error.message || "Failed to delete product family");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    if (!formData.product_name.trim()) {
      toast.error("Product Name is required");
      return;
    }
    if (!formData.list_price || formData.list_price <= 0) {
      toast.error("List Price must be greater than 0");
      return;
    }
    if (!formData.sales_price || formData.sales_price <= 0) {
      toast.error("Sales Price must be greater than 0");
      return;
    }
    
    const normalizedData = {
      ...formData,
      product_family_id: formData.product_family_id || null,
    };

    onSave(normalizedData);
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Product Code
            </label>
            <input
              type="text"
              value={formData.product_number}
              onChange={(e) => setFormData({ ...formData, product_number: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          </div>
        </div>

        {/* Product Family */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Product Family
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <select
                value={formData.product_family_id}
                onChange={(e) => setFormData({ ...formData, product_family_id: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent appearance-none bg-white"
                disabled={familiesLoading}
              >
                <option value="">{NONE_PRODUCT_FAMILY_LABEL}</option>
                {productFamilies.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none"
                size={20}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFamilyModal(true)}
              className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors inline-flex items-center justify-center"
              title="Create new product family"
            >
              <Plus size={20} />
            </button>
            <button
              type="button"
              onClick={handleDeleteFamily}
              disabled={!formData.product_family_id || familiesLoading}
              className="px-4 py-2.5 bg-white border border-gray-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete selected product family"
            >
              <Trash2 size={20} />
            </button>
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
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              required
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-6">
          <button
            type="submit"
            className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
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

      {/* Create Product Family Modal */}
      {showFamilyModal && (
        <CreateProductFamilyModal
          onClose={() => setShowFamilyModal(false)}
          onCreate={handleCreateFamily}
        />
      )}
    </div>
  );
}

// CSV Column Mapping Component
function CsvColumnMapping({
  headers,
  mapping,
  onMappingChange,
  sampleData,
  productFamilies,
  onCancel,
  onImport,
}: {
  headers: string[];
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  sampleData: Record<string, any>;
  productFamilies: any[];
  onCancel: () => void;
  onImport: () => void;
}) {
  const requiredFields = [
    { key: "product_name", label: "Product Name", required: true },
    { key: "list_price", label: "List Price", required: true },
    { key: "sales_price", label: "Sales Price", required: true },
  ];

  const optionalFields = [
    { key: "product_family", label: "Product Family", required: false },
    { key: "product_number", label: "Product Code", required: false },
    { key: "product_brand", label: "Product Brand", required: false },
    { key: "product_type", label: "Product Type", required: false },
    { key: "description", label: "Description", required: false },
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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
          <p className="text-xs text-yellow-700 mt-2">
            Products without a mapped Product Family will default to {NONE_PRODUCT_FAMILY_LABEL}.
          </p>
        </div>
      )}

      <div className="flex gap-3 pt-8">
        <button
          onClick={onImport}
          disabled={!isValid}
          className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
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

// Create Product Family Modal Component
function CreateProductFamilyModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const [familyName, setFamilyName] = useState("");
  const [familyDescription, setFamilyDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!familyName.trim()) {
      toast.error("Family name is required");
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate(familyName.trim(), familyDescription.trim());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">Create Product Family</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={isSubmitting}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Family Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="e.g., HVAC Equipment, Plumbing"
              required
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description (Optional)
            </label>
            <textarea
              value={familyDescription}
              onChange={(e) => setFamilyDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
              placeholder="Brief description of this product family..."
              disabled={isSubmitting}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isSubmitting ? "Creating..." : "Create Family"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Product Family Manager Component
function ProductFamilyManager({
  productFamilies,
  products,
  onClose,
  onUpdate,
  onDelete,
}: {
  productFamilies: ProductFamily[];
  products: Product[];
  onClose: () => void;
  onUpdate: (id: string, updates: any) => Promise<any>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingFamily, setEditingFamily] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const getProductCount = (familyId: string) => {
    return products.filter((p) => p.product_family_id === familyId).length;
  };

  const handleEdit = (family: any) => {
    setEditingFamily(family);
    setEditName(family.name);
    setEditDescription(family.description || "");
  };

  const handleSaveEdit = async () => {
    if (!editingFamily || !editName.trim()) return;
    
    try {
      await onUpdate(editingFamily.id, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      toast.success("Family updated successfully");
      setEditingFamily(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to update family");
    }
  };

  const handleDelete = async (family: any) => {
    const productCount = getProductCount(family.id);
    
    let confirmMessage = `Are you sure you want to delete "${family.name}"?`;
    if (productCount > 0) {
      confirmMessage += `\n\n${productCount} product${productCount === 1 ? '' : 's'} will be set to ${NONE_PRODUCT_FAMILY_LABEL}.`;
    }
    
    if (!confirm(confirmMessage)) return;
    
    setIsDeleting(family.id);
    try {
      await onDelete(family.id);
      toast.success("Family deleted successfully");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete family");
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Manage Product Families</h3>
            <p className="text-sm text-gray-500 mt-1">
              {productFamilies.length} {productFamilies.length === 1 ? "family" : "families"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Family List */}
        <div className="flex-1 overflow-y-auto p-6">
          {productFamilies.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No product families yet.</p>
              <p className="text-sm text-gray-400 mt-1">Create one when adding a new product.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {productFamilies.map((family) => (
                <div
                  key={family.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                >
                  {editingFamily?.id === family.id ? (
                    // Edit Mode
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Family Name
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEdit}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingFamily(null)}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900">{family.name}</h4>
                        {family.description && (
                          <p className="text-sm text-gray-600 mt-1">{family.description}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          {getProductCount(family.id)} product{getProductCount(family.id) === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleEdit(family)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Edit family"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(family)}
                          disabled={isDeleting === family.id}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Delete family"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-6 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Product Detail Component
function ProductDetail({
  product,
  productFamilies,
  onBack,
  onEdit,
  onDelete,
}: {
  product: Product;
  productFamilies: ProductFamily[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const family = productFamilies.find((f) => f.id === product.product_family_id);

  return (
    <div className="max-w-4xl mx-auto p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                Product
              </span>
              <h2 className="text-2xl font-bold text-gray-900">{product.product_name}</h2>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              {product.product_number && (
                <div>
                  <span className="font-medium">Product Code:</span> {product.product_number}
                </div>
              )}
              {family && (
                <div>
                  <span className="font-medium">Product Family:</span> {family.name}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onEdit}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors inline-flex items-center gap-2 font-medium"
            >
              <Edit size={16} />
              Edit
            </button>
            <button
              onClick={onDelete}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors inline-flex items-center gap-2 font-medium"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Details Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">Details</h3>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Row 1: Product Name and Code */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Product Name</label>
              <p className="text-base text-gray-900">{product.product_name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Product Code</label>
              <p className="text-base text-gray-900">{product.product_number || "—"}</p>
            </div>
          </div>

          {/* Row 2: Brand and Type */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Product Brand</label>
              <p className="text-base text-gray-900">{product.product_brand || "—"}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Product Type</label>
              <p className="text-base text-gray-900">{product.product_type || "—"}</p>
            </div>
          </div>

          {/* Row 3: Product Family */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Product Family</label>
            <p className="text-base text-gray-900">
              {family ? family.name : NONE_PRODUCT_FAMILY_LABEL}
            </p>
            {family && family.description && (
              <p className="text-sm text-gray-600 mt-1">{family.description}</p>
            )}
          </div>

          {/* Row 4: Description */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Description</label>
            <p className="text-base text-gray-900 whitespace-pre-wrap">
              {product.description || "—"}
            </p>
          </div>

          {/* Row 5: Pricing */}
          <div className="grid grid-cols-3 gap-6 pt-4 border-t border-gray-200">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">List Price</label>
              <p className="text-lg font-semibold text-gray-900">${product.list_price.toLocaleString()}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Sales Price</label>
              <p className="text-lg font-semibold text-green-600">${product.sales_price.toLocaleString()}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Cost Price</label>
              <p className="text-lg font-semibold text-gray-900">
                {product.cost_price ? `$${product.cost_price.toLocaleString()}` : "—"}
              </p>
            </div>
          </div>

          {/* Row 6: Unit */}
          <div className="pt-4 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-500 mb-1">Unit</label>
            <p className="text-base text-gray-900">{product.unit || "ea"}</p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
        >
          Cancel
        </button>
        <button
          onClick={onEdit}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
        >
          Save & New
        </button>
        <button
          onClick={onEdit}
          className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// Unmapped Columns Warning Component
function UnmappedColumnsWarning({
  unmappedCount,
  onCancel,
  onConfirm,
}: {
  unmappedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">Confirm</h3>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-gray-700 text-base leading-relaxed">
            You have <strong>{unmappedCount}</strong> unmapped {unmappedCount === 1 ? 'column' : 'columns'}. 
            Are you sure you want to continue the import without mapping?
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onCancel}
            className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-8 py-2.5 bg-yellow-400 text-gray-900 rounded-lg hover:bg-yellow-500 transition-colors font-medium"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

