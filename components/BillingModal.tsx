"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Check, CreditCard, AlertCircle, ChevronDown, ArrowLeft, Plus, Download, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { 
  Subscription, 
  PlanType, 
  BillingCycle, 
  UserOrganizationContext,
  PLAN_PRICING,
  StripePaymentMethod,
  StripeInvoice,
  ProrationPreview
} from "@/types/database";
import { createCheckoutSession, openCustomerPortal, fetchPaymentMethods, fetchInvoices, fetchProrationPreview, cancelPendingPlanChange } from "@/lib/stripe/client-utils";

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = "overview" | "edit-plan" | "cancel";
type PlanTab = "individual" | "organization";

export default function BillingModal({ isOpen, onClose }: BillingModalProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [orgContext, setOrgContext] = useState<UserOrganizationContext | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanType | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>("yearly");
  const [additionalLicenses, setAdditionalLicenses] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [planTab, setPlanTab] = useState<PlanTab>("individual");
  const [manageDropdownOpen, setManageDropdownOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(null);
  
  // Billing data state
  const [paymentMethods, setPaymentMethods] = useState<StripePaymentMethod[]>([]);
  const [invoices, setInvoices] = useState<StripeInvoice[]>([]);
  const [invoicesPagination, setInvoicesPagination] = useState<string | null>(null);
  const [hasMoreInvoices, setHasMoreInvoices] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Proration preview state
  const [showProrationPreview, setShowProrationPreview] = useState(false);
  const [prorationData, setProrationData] = useState<ProrationPreview | null>(null);
  const [loadingProration, setLoadingProration] = useState(false);
  const [pendingPlanChange, setPendingPlanChange] = useState<{
    plan: PlanType;
    cycle: BillingCycle;
    licenses: number;
  } | null>(null);

  const loadSubscriptionData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      // Get organization context
      const { data: contextData, error: contextError } = await supabase
        .rpc("get_user_organization_membership", { p_user_id: user.id });
      
      if (contextError) {
        console.error("Organization context error:", contextError);
        throw contextError;
      }
      if (!contextData || contextData.length === 0) {
        throw new Error("No organization found");
      }

      const context = contextData[0] as UserOrganizationContext;
      setOrgContext(context);

      // Get full subscription details - ORDER BY updated_at DESC to get the MOST RECENT subscription
      // This fixes the issue where multiple subscriptions exist and we show the wrong one
      const { data: subData, error: subError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("organization_id", context.organization_id)
        .in("status", ["active", "trialing", "past_due"]) // Only show active/relevant subscriptions
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (subError) throw subError;
      if (!subData) throw new Error("No subscription found");

      setSubscription(subData);
      setSelectedPlan(subData.plan_type);
      setSelectedCycle(subData.billing_cycle || "yearly");
      setAdditionalLicenses(subData.additional_licenses);

      // Fetch billing data if user has a Stripe customer (includes trial users with payment methods)
      // Get stripe_customer_id from profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single();

      const customerIdFromProfile = profileData?.stripe_customer_id;
      setStripeCustomerId(customerIdFromProfile || null);

      if (customerIdFromProfile || subData.stripe_subscription_id) {
        try {
          // Fetch payment methods and invoices in parallel
          const [paymentMethodsData, invoicesData] = await Promise.all([
            fetchPaymentMethods(),
            fetchInvoices(10),
          ]);

          setPaymentMethods(paymentMethodsData);
          setInvoices(invoicesData.invoices);
          setHasMoreInvoices(invoicesData.hasMore);
          
          // Set pagination cursor to last invoice ID if there are more
          if (invoicesData.hasMore && invoicesData.invoices.length > 0) {
            const lastInvoice = invoicesData.invoices[invoicesData.invoices.length - 1];
            setInvoicesPagination(lastInvoice.id);
          }
        } catch (billingError: any) {
          console.error("Failed to load billing data:", billingError);
          // Don't show error toast for billing data - it's not critical
        }
      }
    } catch (error: any) {
      console.error("Failed to load subscription:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      const errorMessage = error?.message || error?.error_description || error?.hint || "Failed to load subscription";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (isOpen) {
      loadSubscriptionData();
      setViewMode("overview");
    }
  }, [isOpen, loadSubscriptionData]);

  const loadMoreInvoices = async () => {
    if (!invoicesPagination || loadingInvoices) return;
    
    setLoadingInvoices(true);
    try {
      const invoicesData = await fetchInvoices(10, invoicesPagination);
      
      setInvoices(prev => [...prev, ...invoicesData.invoices]);
      setHasMoreInvoices(invoicesData.hasMore);
      
      // Update pagination cursor
      if (invoicesData.hasMore && invoicesData.invoices.length > 0) {
        const lastInvoice = invoicesData.invoices[invoicesData.invoices.length - 1];
        setInvoicesPagination(lastInvoice.id);
      } else {
        setInvoicesPagination(null);
      }
    } catch (error: any) {
      console.error("Failed to load more invoices:", error);
      toast.error("Failed to load more invoices");
    } finally {
      setLoadingInvoices(false);
    }
  };

  const calculatePrice = (plan: PlanType, cycle: BillingCycle, addLicenses: number = 0) => {
    if (plan === "free") return { monthly: 0, total: 0 };

    if (plan === "individual") {
      const monthlyPrice = PLAN_PRICING.individual[cycle];
      const total = cycle === "yearly" ? monthlyPrice * 12 : monthlyPrice;
      return { monthly: monthlyPrice, total };
    }

    // Organization plan
    const basePrice = PLAN_PRICING.organization[cycle].base;
    const perLicensePrice = PLAN_PRICING.organization[cycle].perAdditionalLicense;
    const additionalCost = addLicenses * perLicensePrice;
    const monthlyPrice = basePrice + additionalCost;
    const total = cycle === "yearly" ? monthlyPrice * 12 : monthlyPrice;
    return { monthly: monthlyPrice, total };
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getDaysRemaining = () => {
    if (!subscription?.trial_end_date) return 0;
    const endDate = new Date(subscription.trial_end_date);
    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const handleUpgradePlan = async (plan: PlanType, cycle: BillingCycle) => {
    if (!isOwner) {
      toast.error("Only the owner can upgrade the plan");
      return;
    }

    // For all subscriptions (including trials), show proration preview first
    try {
      setLoadingProration(true);
      const preview = await fetchProrationPreview(plan, cycle, additionalLicenses);
      
      setProrationData(preview);
      setPendingPlanChange({ plan, cycle, licenses: additionalLicenses });
      setShowProrationPreview(true);
    } catch (error: any) {
      console.error("Proration preview error:", error);
      toast.error(error.message || "Failed to preview changes");
    } finally {
      setLoadingProration(false);
    }
  };

  const handleConfirmPlanChange = async () => {
    if (!pendingPlanChange || !prorationData) return;

    try {
      const loadingToast = toast.loading("Processing payment...");

      // For all changes on existing subscriptions:
      // - Upgrades: Stripe automatically charges card on file via subscription update API
      // - Downgrades: Scheduled for period end, no charge
      // NO CHECKOUT REDIRECT needed
      const result = await createCheckoutSession(
        pendingPlanChange.plan,
        pendingPlanChange.cycle,
        pendingPlanChange.licenses,
        false // Never force checkout for existing subscriptions
      );
      
      toast.dismiss(loadingToast);
      
      if (result?.scheduled) {
        // Downgrade scheduled
        toast.success("Downgrade scheduled successfully!");
        
        // Use returned subscription data if available, otherwise reload
        if (result.subscription) {
          setSubscription(result.subscription);
        } else {
          await loadSubscriptionData();
        }
        
        setViewMode("overview");
        setShowProrationPreview(false);
        setPendingPlanChange(null);
        setProrationData(null);
      } else if (result?.updated) {
        // Upgrade completed in-place
        toast.success("Plan upgraded successfully! Payment processed.");
        
        // Use returned subscription data if available, otherwise reload
        if (result.subscription) {
          setSubscription(result.subscription);
        } else {
          await loadSubscriptionData();
        }
        
        setViewMode("overview");
        setShowProrationPreview(false);
        setPendingPlanChange(null);
        setProrationData(null);
      } else if (result?.url) {
        // Only happens for first-time purchases (no existing subscription)
        window.location.href = result.url;
      }
    } catch (error: any) {
      console.error("Plan change error:", error);
      toast.error(error.message || "Failed to update plan");
    }
  };

  const handleManagePayment = async () => {
    if (!isOwner) {
      toast.error("Only the owner can manage payment methods");
      return;
    }

    try {
      const loadingToast = toast.loading("Opening billing portal...");
      await openCustomerPortal();
      toast.dismiss(loadingToast);
    } catch (error: any) {
      console.error("Portal error:", error);
      toast.error(error.message || "Failed to open billing portal");
    }
  };

  const handleCancelPendingChange = async () => {
    if (!isOwner) {
      toast.error("Only the owner can cancel pending changes");
      return;
    }

    try {
      toast.loading("Canceling...", { id: "cancelToast" });
      await cancelPendingPlanChange();
      toast.success("Pending plan change canceled", { id: "cancelToast" });
      await loadSubscriptionData(); // Reload to clear pending change from UI
    } catch (error: any) {
      console.error("Cancel error:", error);
      toast.error(error.message || "Failed to cancel pending change", { id: "cancelToast" });
    }
  };

  const handleCancelSubscription = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please tell us why you're canceling");
      return;
    }

    // Open Customer Portal for cancellation
    try {
      toast.loading("Opening cancellation flow...");
      await openCustomerPortal();
    } catch (error: any) {
      console.error("Cancel error:", error);
      toast.error(error.message || "Failed to open cancellation flow");
    }
  };

  const getPlanDisplayName = (plan: PlanType) => {
    if (plan === "free") return "Free Trial";
    if (plan === "individual") return "Individual";
    return "Organization";
  };

  if (!isOpen) return null;

  const isOwner = orgContext?.role === "owner";
  const isTrialing = subscription?.status === "trialing";
  const daysRemaining = getDaysRemaining();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            {viewMode !== "overview" && (
              <button
                onClick={() => setViewMode("overview")}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {viewMode === "overview" ? "Billing & Plans" : viewMode === "edit-plan" ? "Upgrade your plan" : "Cancel Subscription"}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close billing modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <p className="mt-4 text-sm text-gray-500">Loading...</p>
            </div>
          ) : (
            <>
              {/* OVERVIEW VIEW */}
              {viewMode === "overview" && (
                <>
                  {/* Pending Downgrade Banner */}
                  {subscription?.pending_plan_change && (
                    <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertCircle className="w-5 h-5 text-blue-600" />
                            <h4 className="font-semibold text-blue-900">Downgrade Scheduled</h4>
                          </div>
                          <p className="text-sm text-blue-700 mb-2">
                            Your plan will change to{" "}
                            <span className="font-bold">
                              {subscription.pending_plan_change.plan_type === "individual" ? "Individual" : "Organization"}{" "}
                              {subscription.pending_plan_change.billing_cycle === "monthly" ? "Monthly" : "Yearly"}
                            </span>{" "}
                            on{" "}
                            <span className="font-bold">
                              {new Date(subscription.pending_plan_change.scheduled_for).toLocaleDateString('en-US', {
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </span>
                          </p>
                          {isOwner && (
                            <button
                              onClick={handleCancelPendingChange}
                              className="text-sm text-blue-700 hover:text-blue-900 font-medium underline"
                            >
                              Cancel scheduled downgrade
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Current Plan Card */}
                  {subscription && (
                    <div className="mb-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-2xl font-bold text-gray-900">
                            {getPlanDisplayName(subscription.plan_type)}
                          </h3>
                          {subscription.plan_type !== "free" && (
                            <p className="text-3xl font-bold text-gray-900 mt-2">
                              {formatCurrency(
                                subscription.base_price_cents + 
                                (subscription.additional_licenses * subscription.additional_license_price_cents)
                              )}
                              <span className="text-lg font-normal text-gray-600"> per month</span>
                            </p>
                          )}
                        </div>
                        
                        {/* Manage Dropdown */}
                        <div className="relative">
                          <button
                            onClick={() => setManageDropdownOpen(!manageDropdownOpen)}
                            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                            disabled={!isOwner}
                          >
                            <span className="font-medium">Manage</span>
                            <ChevronDown size={16} />
                          </button>
                          
                          {manageDropdownOpen && (
                            <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-20">
                              <button
                                onClick={() => {
                                  setViewMode("edit-plan");
                                  setManageDropdownOpen(false);
                                }}
                                className="w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors flex items-center gap-2"
                              >
                                <span className="text-2xl">✨</span>
                                <span>Edit plan</span>
                              </button>
                              <button
                                onClick={() => {
                                  setViewMode("cancel");
                                  setManageDropdownOpen(false);
                                }}
                                className="w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors flex items-center gap-2 text-red-600"
                              >
                                <span className="text-xl">✕</span>
                                <span>Cancel Subscription</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Trial Banner */}
                      {isTrialing && (
                        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="text-sm text-blue-800">
                            <span className="font-medium">Free Trial Active</span> — You have{" "}
                            <strong>{daysRemaining} days</strong> remaining in your 14-day free trial
                          </p>
                        </div>
                      )}

                      {/* Plan Details */}
                      {subscription.plan_type !== "free" && (
                        <div className="text-sm text-gray-600 space-y-1">
                          <p>Billed {subscription.billing_cycle === "monthly" ? "monthly" : "yearly"}</p>
                          <p>{subscription.total_licenses} user license{subscription.total_licenses !== 1 ? "s" : ""}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Payment Method Section */}
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 mb-3">PAYMENT METHOD</h3>
                    {paymentMethods.length > 0 ? (
                      <div className="space-y-3">
                        {paymentMethods.map((pm) => (
                          <div
                            key={pm.id}
                            className="p-4 border border-gray-200 rounded-lg flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <CreditCard size={24} className="text-gray-600" />
                              <div>
                                <p className="font-medium text-gray-900 capitalize">
                                  {pm.brand} •••• {pm.last4}
                                </p>
                                <p className="text-sm text-gray-500">
                                  Expires {pm.exp_month}/{pm.exp_year}
                                </p>
                              </div>
                            </div>
                            {isOwner && (
                              <button
                                onClick={handleManagePayment}
                                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                              >
                                Manage
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={handleManagePayment}
                          disabled={!isOwner || (!subscription?.stripe_subscription_id && !stripeCustomerId)}
                          className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Plus size={20} />
                          <span>Add payment method</span>
                        </button>
                        {!subscription?.stripe_subscription_id && !stripeCustomerId && (
                          <p className="text-xs text-gray-500 mt-2">
                            Subscribe to a plan to add payment methods
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Invoice History Section */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3">INVOICE HISTORY</h3>
                    {invoices.length > 0 ? (
                      <div className="space-y-3">
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                              <tr>
                                <th className="px-4 py-3 text-left font-medium text-gray-700">Invoice #</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-700">Date</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-700">Amount</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-700">Status</th>
                                <th className="px-4 py-3 text-right font-medium text-gray-700">Download</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {invoices.map((invoice) => (
                                <tr key={invoice.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-gray-900">
                                    {invoice.number || invoice.id.slice(-8)}
                                  </td>
                                  <td className="px-4 py-3 text-gray-600">
                                    {new Date(invoice.created * 1000).toLocaleDateString()}
                                  </td>
                                  <td className="px-4 py-3 text-gray-900 font-medium">
                                    ${(invoice.amount_paid / 100).toFixed(2)}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                                      invoice.status === "paid"
                                        ? "bg-green-100 text-green-800"
                                        : invoice.status === "open"
                                        ? "bg-yellow-100 text-yellow-800"
                                        : "bg-gray-100 text-gray-800"
                                    }`}>
                                      {invoice.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {invoice.invoice_pdf && (
                                      <a
                                        href={invoice.invoice_pdf}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                                      >
                                        <Download size={16} />
                                        <span>PDF</span>
                                      </a>
                                    )}
                                    {!invoice.invoice_pdf && invoice.hosted_invoice_url && (
                                      <a
                                        href={invoice.hosted_invoice_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                                      >
                                        <ExternalLink size={16} />
                                        <span>View</span>
                                      </a>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {hasMoreInvoices && (
                          <button
                            onClick={loadMoreInvoices}
                            disabled={loadingInvoices}
                            className="w-full py-2 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {loadingInvoices ? "Loading..." : "Load more invoices"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="p-8 bg-gray-50 rounded-lg text-center">
                        <p className="text-sm text-gray-500">No invoices yet</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Your invoice history will appear here once billing starts
                        </p>
                      </div>
                    )}
                  </div>

                  {!isOwner && (
                    <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800">
                        <span className="font-medium">View Only</span> — Only the workspace owner can manage billing
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* EDIT PLAN VIEW */}
              {viewMode === "edit-plan" && (
                <>
                  {/* Plan Tabs */}
                  <div className="flex gap-2 mb-6 border-b border-gray-200">
                    <button
                      onClick={() => setPlanTab("individual")}
                      className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                        planTab === "individual"
                          ? "border-gray-900 text-gray-900"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Individual
                    </button>
                    <button
                      onClick={() => setPlanTab("organization")}
                      className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                        planTab === "organization"
                          ? "border-gray-900 text-gray-900"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Organization
                    </button>
                  </div>

                  {/* Billing Cycle Toggle */}
                  <div className="mb-6 flex items-center justify-center gap-3">
                    <button
                      onClick={() => setSelectedCycle("monthly")}
                      className={`px-6 py-2 rounded-full font-medium transition-colors ${
                        selectedCycle === "monthly"
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      onClick={() => setSelectedCycle("yearly")}
                      className={`px-6 py-2 rounded-full font-medium transition-colors relative ${
                        selectedCycle === "yearly"
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      Yearly
                      <span className="ml-2 text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">
                        Save 20%
                      </span>
                    </button>
                  </div>

                  {/* Plan Card */}
                  {planTab === "individual" ? (
                    <div className="border-2 border-gray-200 rounded-xl p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Individual</h3>
                          <p className="text-sm text-gray-500 mt-1">For solo professionals</p>
                        </div>
                        {subscription?.plan_type === "individual" && (
                          <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">
                            Your current plan
                          </span>
                        )}
                      </div>

                      <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold text-gray-900">
                            {formatCurrency(PLAN_PRICING.individual[selectedCycle])}
                          </span>
                          <span className="text-gray-500">/month</span>
                        </div>
                        {selectedCycle === "yearly" && (
                          <p className="text-sm text-gray-500 mt-1">
                            Billed {formatCurrency(PLAN_PRICING.individual.yearly * 12)} yearly
                          </p>
                        )}
                      </div>

                      <ul className="space-y-3 mb-6">
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>1 user license</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Unlimited projects</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Full price book access</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>AI quote generation</span>
                        </li>
                      </ul>

                      <button
                        onClick={() => handleUpgradePlan("individual", selectedCycle)}
                        disabled={subscription?.plan_type === "individual" && subscription?.billing_cycle === selectedCycle}
                        className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                      >
                        {subscription?.plan_type === "individual" && subscription?.billing_cycle === selectedCycle
                          ? "Current Plan"
                          : "Upgrade to Individual"}
                      </button>
                    </div>
                  ) : (
                    <div className="border-2 border-gray-200 rounded-xl p-6 relative">
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        RECOMMENDED
                      </div>

                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Organization</h3>
                          <p className="text-sm text-gray-500 mt-1">For teams & collaboration</p>
                        </div>
                        {subscription?.plan_type === "organization" && (
                          <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">
                            Your current plan
                          </span>
                        )}
                      </div>

                      <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold text-gray-900">
                            {formatCurrency(
                              calculatePrice("organization", selectedCycle, additionalLicenses).monthly
                            )}
                          </span>
                          <span className="text-gray-500">/month</span>
                        </div>
                        {selectedCycle === "yearly" && (
                          <p className="text-sm text-gray-500 mt-1">
                            Billed {formatCurrency(
                              calculatePrice("organization", selectedCycle, additionalLicenses).total
                            )} yearly
                          </p>
                        )}
                      </div>

                      <ul className="space-y-3 mb-6">
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>2 user licenses included</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Add more licenses ({formatCurrency(PLAN_PRICING.organization[selectedCycle].perAdditionalLicense)}/mo each)</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Shared price book</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Team collaboration</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Role-based permissions</span>
                        </li>
                        <li className="flex items-start gap-2 text-sm">
                          <Check size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                          <span>Priority support</span>
                        </li>
                      </ul>

                      {/* Additional Licenses */}
                      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Additional Licenses
                        </label>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setAdditionalLicenses(Math.max(0, additionalLicenses - 1))}
                            disabled={additionalLicenses === 0}
                            className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed rounded text-gray-700 font-bold transition-colors"
                          >
                            -
                          </button>
                          <span className="flex-1 text-center font-medium">{additionalLicenses}</span>
                          <button
                            onClick={() => setAdditionalLicenses(additionalLicenses + 1)}
                            className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-gray-700 font-bold transition-colors"
                          >
                            +
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Total: {3 + additionalLicenses} licenses
                        </p>
                      </div>

                      <button
                        onClick={() => handleUpgradePlan("organization", selectedCycle)}
                        disabled={
                          subscription?.plan_type === "organization" && 
                          subscription?.billing_cycle === selectedCycle &&
                          subscription?.additional_licenses === additionalLicenses
                        }
                        className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                      >
                        {subscription?.plan_type === "organization" && 
                         subscription?.billing_cycle === selectedCycle &&
                         subscription?.additional_licenses === additionalLicenses
                          ? "Current Plan"
                          : "Upgrade to Organization"}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* CANCEL VIEW */}
              {viewMode === "cancel" && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    We're sorry to see you go
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Please let us know why you're canceling. Your feedback helps us improve.
                  </p>
                  
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Tell us why you're canceling..."
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-none mb-4"
                  />

                  <div className="flex gap-3">
                    <button
                      onClick={() => setViewMode("overview")}
                      className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Keep Subscription
                    </button>
                    <button
                      onClick={handleCancelSubscription}
                      disabled={!cancelReason.trim()}
                      className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                    >
                      Confirm Cancellation
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Proration Preview Modal */}
      {showProrationPreview && prorationData && pendingPlanChange && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">
                Confirm Plan Change
              </h3>
            </div>

            {/* Content */}
            <div className="px-6 py-6 space-y-4">
              {/* Plan Comparison */}
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Current Plan</span>
                  <span className="font-medium text-gray-900">
                    {prorationData.currentPlanDescription}
                  </span>
                </div>
                <div className="flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <span className="text-sm text-blue-700 font-medium">New Plan</span>
                  <span className="font-semibold text-blue-900">
                    {prorationData.newPlanDescription}
                  </span>
                </div>
              </div>

              {/* Proration Details */}
              <div className={`p-4 rounded-lg ${
                prorationData.isUpgrade 
                  ? 'bg-green-50 border-2 border-green-200' 
                  : 'bg-blue-50 border-2 border-blue-200'
              }`}>
                <div className="flex items-start gap-3">
                  <AlertCircle className={`w-5 h-5 mt-0.5 ${
                    prorationData.isUpgrade ? 'text-green-600' : 'text-blue-600'
                  }`} />
                  <div className="flex-1">
                    <p className={`font-semibold mb-1 ${
                      prorationData.isUpgrade ? 'text-green-900' : 'text-blue-900'
                    }`}>
                      {prorationData.isUpgrade ? 'Upgrade Charge' : 'Downgrade Scheduled'}
                    </p>
                    <p className={`text-sm ${
                      prorationData.isUpgrade ? 'text-green-700' : 'text-blue-700'
                    }`}>
                      {prorationData.billingMessage || 'Your plan will be updated.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Billing Anchor Reset Notice */}
              {prorationData.resetsBillingAnchor && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Your billing date will reset to today. Your next renewal will be one {pendingPlanChange.cycle === "monthly" ? "month" : "year"} from now.</span>
                </div>
              )}

              {/* Next Billing Info for immediate changes */}
              {!prorationData.scheduledForPeriodEnd && prorationData.resetsBillingAnchor && (
                <div className="text-sm text-gray-600 pt-2 border-t border-gray-200">
                  <p>
                    Next billing date:{" "}
                    <span className="font-medium text-gray-900">
                      {(() => {
                        const nextDate = new Date();
                        if (pendingPlanChange.cycle === "monthly") {
                          nextDate.setMonth(nextDate.getMonth() + 1);
                        } else {
                          nextDate.setFullYear(nextDate.getFullYear() + 1);
                        }
                        return nextDate.toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric'
                        });
                      })()}
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => {
                  setShowProrationPreview(false);
                  setPendingPlanChange(null);
                  setProrationData(null);
                }}
                className="flex-1 py-3 px-4 bg-white border-2 border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPlanChange}
                disabled={loadingProration}
                className={`flex-1 py-3 px-4 font-medium rounded-lg transition-colors text-white ${
                  prorationData.requiresCheckout
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                } disabled:bg-gray-300 disabled:cursor-not-allowed`}
              >
                {loadingProration ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Processing...</span>
                  </div>
                ) : prorationData.requiresCheckout ? (
                  'Proceed to Checkout'
                ) : (
                  'Confirm Change'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

