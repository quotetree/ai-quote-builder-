import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Edit, Trash2 } from "lucide-react";
import Link from "next/link";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/signin");
  }

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !product) {
    notFound();
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/pricebook"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4"
          >
            <ArrowLeft size={18} />
            Back to Price Book
          </Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {product.product_name}
              </h1>
              {product.product_number && (
                <p className="text-gray-500">Product #{product.product_number}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2">
                <Edit size={18} />
                Edit
              </button>
              <button className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors inline-flex items-center gap-2">
                <Trash2 size={18} />
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Product Details */}
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Product Information</h2>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-1">Product Name</dt>
                <dd className="text-base text-gray-900">{product.product_name}</dd>
              </div>
              {product.product_number && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 mb-1">Product Number</dt>
                  <dd className="text-base text-gray-900">{product.product_number}</dd>
                </div>
              )}
              {product.product_type && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 mb-1">Product Type</dt>
                  <dd className="text-base text-gray-900">{product.product_type}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500 mb-1">Unit</dt>
                <dd className="text-base text-gray-900">{product.unit || "ea"}</dd>
              </div>
            </dl>
          </div>

          {product.description && (
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-2">Description</h2>
              <p className="text-gray-700 whitespace-pre-wrap">{product.description}</p>
            </div>
          )}

          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Pricing</h2>
            <dl className="grid grid-cols-3 gap-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <dt className="text-sm font-medium text-gray-500 mb-2">List Price</dt>
                <dd className="text-2xl font-bold text-gray-900">
                  ${product.list_price.toLocaleString()}
                </dd>
              </div>
              <div className="bg-blue-50 rounded-lg p-4">
                <dt className="text-sm font-medium text-blue-600 mb-2">Sales Price</dt>
                <dd className="text-2xl font-bold text-blue-600">
                  ${product.sales_price.toLocaleString()}
                </dd>
              </div>
              {product.cost_price > 0 && (
                <div className="bg-green-50 rounded-lg p-4">
                  <dt className="text-sm font-medium text-green-600 mb-2">Cost Price</dt>
                  <dd className="text-2xl font-bold text-green-600">
                    ${product.cost_price.toLocaleString()}
                  </dd>
                  {product.sales_price > product.cost_price && (
                    <p className="text-xs text-green-600 mt-1">
                      Margin: $
                      {(product.sales_price - product.cost_price).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </dl>
          </div>

          <div className="p-6 bg-gray-50">
            <h2 className="text-lg font-semibold mb-4">Metadata</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500 mb-1">Created</dt>
                <dd className="text-gray-900">
                  {new Date(product.created_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 mb-1">Last Updated</dt>
                <dd className="text-gray-900">
                  {new Date(product.updated_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

