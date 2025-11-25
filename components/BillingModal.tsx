"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Check, CreditCard, AlertCircle, ChevronDown, ArrowLeft, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { 
  Subscription, 
  PlanType, 
  BillingCycle, 
  UserOrganizationContext,
  PLAN_PRICING 
} from "@/types/database";
import { createCheckoutSession, openCustomerPortal } from "@/lib/stripe/client-utils";

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

      // Get full subscription details
      const { data: subData, error: subError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("organization_id", context.organization_id)
        .single();

      if (subError) throw subError;
      if (!subData) throw new Error("No subscription found");

      setSubscription(subData);
      setSelectedPlan(subData.plan_type);
      setSelectedCycle(subData.billing_cycle || "yearly");
      setAdditionalLicenses(subData.additional_licenses);
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

    try {
      toast.loading("Redirecting to checkout...");
      await createCheckoutSession(plan, cycle, additionalLicenses);
    } catch (error: any) {
      console.error("Upgrade error:", error);
      toast.error(error.message || "Failed to start checkout");
    }
  };

  const handleManagePayment = async () => {
    if (!isOwner) {
      toast.error("Only the owner can manage payment methods");
      return;
    }

    try {
      toast.loading("Opening billing portal...");
      await openCustomerPortal();
    } catch (error: any) {
      console.error("Portal error:", error);
      toast.error(error.message || "Failed to open billing portal");
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
                              {formatCurrency(subscription.base_price_cents)}
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
                            <strong>{daysRemaining} days</strong> remaining in your 30-day free trial
                          </p>
                        </div>
                      )}

                      {/* Plan Details */}
                      {subscription.plan_type !== "free" && (
                        <div className="text-sm text-gray-600 space-y-1">
                          <p>Billed {subscription.billing_cycle}</p>
                          <p>{subscription.total_licenses} user license{subscription.total_licenses !== 1 ? "s" : ""}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Payment Method Section */}
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 mb-3">PAYMENT METHOD</h3>
                    <button
                      onClick={handleManagePayment}
                      disabled={!isOwner || !subscription?.stripe_subscription_id}
                      className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 transition-colors flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={20} />
                      <span>Add payment method</span>
                    </button>
                    {!subscription?.stripe_subscription_id && (
                      <p className="text-xs text-gray-500 mt-2">
                        Subscribe to a plan to add payment methods
                      </p>
                    )}
                  </div>

                  {/* Billing Information Section */}
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 mb-3">BILLING INFORMATION</h3>
                    <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
                      <p>Billing information will appear here after adding a payment method</p>
                    </div>
                  </div>

                  {/* Invoice History Section */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3">INVOICE HISTORY</h3>
                    <div className="p-8 bg-gray-50 rounded-lg text-center">
                      <p className="text-sm text-gray-500">No invoices yet</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Your invoice history will appear here once billing starts
                      </p>
                    </div>
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
                          <span>3 user licenses included</span>
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
    </div>
  );
}

