"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Play, CheckCircle, ChevronDown, X } from "lucide-react";
import Image from "next/image";

const userJourneySteps = [
  {
    id: 1,
    title: "Create New Project",
    description: "Start by creating a new project with a descriptive name",
    image: "/screenshots/new-project.png",
  },
  {
    id: 2,
    title: "Describe Your Scope",
    description: "Chat with AI to describe your project requirements",
    image: "/screenshots/scope-chat.png",
  },
  {
    id: 3,
    title: "Review AI Suggestions",
    description: "Get instant product recommendations and quantities",
    image: "/screenshots/chat-results.png",
  },
  {
    id: 4,
    title: "Select Products & Add Markup",
    description: "Review products, adjust quantities, and set your markup",
    image: "/screenshots/products-markup.png",
  },
  {
    id: 5,
    title: "Review Quote Log",
    description: "Manage all your quotes in one organized place",
    image: "/screenshots/quote-log.png",
  },
  {
    id: 6,
    title: "Download Professional Quote",
    description: "Generate and download beautifully formatted quotes",
    image: "/screenshots/quote-pdf.png",
  },
];

const pricingPlans = {
  monthly: [
    {
      name: "Free Trial",
      price: 0,
      period: "forever",
      description: "Perfect for trying out QuoteTree",
      features: [
        "3 quotes per month",
        "Basic AI chat assistant",
        "Standard product library",
        "PDF quote generation",
        "Email support",
      ],
      cta: "Start Free Trial",
      highlighted: false,
    },
    {
      name: "Single User",
      price: 97,
      period: "month",
      description: "Ideal for independent contractors",
      features: [
        "Unlimited quotes",
        "Advanced AI chat assistant",
        "Full product library access",
        "Custom price book",
        "PDF & Excel export",
        "Priority support",
        "Chat history preservation",
        "Custom markup presets",
      ],
      cta: "Start Free Trial",
      highlighted: true,
    },
    {
      name: "Organization",
      price: 158,
      period: "month",
      description: "Best for growing teams",
      features: [
        "Everything in Single User",
        "Up to 2 team members",
        "Shared price book",
        "Team collaboration",
        "Centralized quote log",
        "Admin dashboard",
        "Bulk product import",
        "API access",
      ],
      cta: "Start Free Trial",
      highlighted: false,
    },
  ],
  yearly: [
    {
      name: "Free Trial",
      price: 0,
      period: "forever",
      description: "Perfect for trying out QuoteTree",
      features: [
        "3 quotes per month",
        "Basic AI chat assistant",
        "Standard product library",
        "PDF quote generation",
        "Email support",
      ],
      cta: "Start Free Trial",
      highlighted: false,
    },
    {
      name: "Single User",
      price: 79,
      period: "month",
      yearlyTotal: 948,
      description: "Ideal for independent contractors",
      features: [
        "Unlimited quotes",
        "Advanced AI chat assistant",
        "Full product library access",
        "Custom price book",
        "PDF & Excel export",
        "Priority support",
        "Chat history preservation",
        "Custom markup presets",
      ],
      cta: "Start Free Trial",
      highlighted: true,
      savings: "Save $216/year",
    },
    {
      name: "Organization",
      price: 130,
      period: "month",
      yearlyTotal: 1560,
      description: "Best for growing teams",
      features: [
        "Everything in Single User",
        "Up to 2 team members",
        "Shared price book",
        "Team collaboration",
        "Centralized quote log",
        "Admin dashboard",
        "Bulk product import",
        "API access",
      ],
      cta: "Start Free Trial",
      highlighted: false,
      savings: "Save $336/year",
    },
  ],
};

const faqs = [
  {
    question: "What to expect on the 15-min demo call?",
    answer:
      "During the demo, we'll walk you through the entire quote creation process, from starting a project to downloading your finished quote. You'll see how the AI assistant works, how to customize your price book, and how QuoteTree can save you hours every week.",
  },
  {
    question: "Will it work for my industry / products?",
    answer:
      "QuoteTree is designed for contractors and service providers across multiple industries including security systems, electrical, HVAC, networking, and more. Our AI is trained on diverse product catalogs and can adapt to your specific needs. You can also import your own price book for complete customization.",
  },
  {
    question: "What kind of support do you offer?",
    answer:
      "All plans include email support with response times within 24 hours. Paid plans get priority support with faster response times. We also offer a comprehensive knowledge base, video tutorials, and regular webinars to help you get the most out of QuoteTree.",
  },
  {
    question: "Can you help me find new customers?",
    answer:
      "While QuoteTree focuses on streamlining your quoting process, we do offer integrations with popular CRM systems to help you track leads. Our goal is to help you respond to opportunities faster with professional quotes, giving you a competitive advantage in winning new business.",
  },
  {
    question: "Do I need to connect to my CRM?",
    answer:
      "No, QuoteTree works as a standalone tool. However, if you use a CRM, we offer optional integrations that can sync your quotes and project data, making your workflow even more seamless.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes! All paid plans are month-to-month with no long-term commitment. You can cancel anytime from your account settings, and you'll continue to have access until the end of your billing period.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit cards (Visa, Mastercard, American Express, Discover) and process payments securely through Stripe. Annual plans can also be paid via ACH transfer upon request.",
  },
];

export default function LandingPageClient() {
  const [activeStep, setActiveStep] = useState(1);
  const [isYearly, setIsYearly] = useState(true); // Default to annual
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [additionalLicenses, setAdditionalLicenses] = useState(0);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const router = useRouter();

  // Handle password recovery - check for code parameter OR hash tokens
  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const hash = window.location.hash;
    const fullUrl = window.location.href;
    
    console.log('=== Password Recovery Detection ===');
    console.log('Full URL:', fullUrl);
    console.log('Code param:', code);
    console.log('Hash:', hash);
    
    // Check for code parameter (PKCE flow)
    if (code) {
      console.log('🔄 Password reset code detected! Server should handle this...');
      // The server-side page.tsx should handle code exchange and redirect
      // If we're seeing this, the server redirect didn't work
      console.log('⚠️ If you see this, the server-side code exchange may have failed');
      return;
    }
    
    // Check for successful recovery token (hash-based legacy flow)
    if (hash && hash.includes('access_token=') && hash.includes('type=recovery')) {
      console.log('✅ Recovery token detected! Redirecting to reset-password page');
      router.replace('/auth/reset-password' + hash);
      return;
    }
    
    // Check for error cases (expired token, invalid link, etc.)
    if (hash && hash.includes('error=') && (hash.includes('otp_expired') || hash.includes('access_denied'))) {
      console.log('❌ Password reset link expired or invalid');
      router.replace('/auth/reset-password?error=expired');
      return;
    }
    
    console.log('ℹ️ No recovery token or code detected, staying on homepage');
  }, []); // Run once on mount

  const billingCycle = isYearly ? "yearly" : "monthly";
  const currentPlans = isYearly ? pricingPlans.yearly : pricingPlans.monthly;

  // Handle checkout for landing page users (unauthenticated)
  const handleCheckout = async (
    planType: 'individual' | 'organization',
    trialDays?: number
  ) => {
    setIsCheckoutLoading(true);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType,
          billingCycle: isYearly ? 'yearly' : 'monthly',
          additionalLicenses: planType === 'organization' ? additionalLicenses : 0,
          trialPeriodDays: trialDays,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create checkout');
      }
      
      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      alert(error.message || 'Failed to start checkout. Please try again.');
      setIsCheckoutLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-8">
            {/* Logo and Company Name */}
            <Link href="/" className="flex items-center gap-1">
              <Image
                src="/quotetree-icon.svg"
                alt="QuoteTree Logo"
                width={56}
                height={56}
                className="w-14 h-14"
              />
              <span className="text-2xl font-medium text-green-700">QuoteTree</span>
            </Link>
            
            {/* Navigation Links */}
            <div className="hidden md:flex items-center gap-8">
              <Link
                href="#features"
                className="text-gray-700 hover:text-gray-900 transition-colors"
              >
                Features
              </Link>
              <Link
                href="#blog"
                className="text-gray-700 hover:text-gray-900 transition-colors"
              >
                Blog
              </Link>
              <Link
                href="#pricing"
                className="text-gray-700 hover:text-gray-900 transition-colors"
              >
                Pricing
              </Link>
              <Link
                href="#faq"
                className="text-gray-700 hover:text-gray-900 transition-colors"
              >
                FAQ
              </Link>
            </div>
          </div>
          
          <div className="flex gap-4">
            <Link
              href="/auth/signin"
              className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors font-medium"
            >
              Login
            </Link>
            <button
              onClick={async () => {
                setIsCheckoutLoading(true);
                try {
                  const response = await fetch('/api/stripe/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      planType: 'individual',
                      billingCycle: 'monthly',
                      additionalLicenses: 0,
                      trialPeriodDays: 14,
                    }),
                  });
                  
                  if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to create checkout');
                  }
                  
                  const { url } = await response.json();
                  if (url) {
                    window.location.href = url;
                  }
                } catch (error: any) {
                  console.error('Checkout error:', error);
                  alert(error.message || 'Failed to start checkout. Please try again.');
                  setIsCheckoutLoading(false);
                }
              }}
              disabled={isCheckoutLoading}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all hover:shadow-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCheckoutLoading ? 'Loading...' : 'Get Started'}
            </button>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">

        <div className="text-center max-w-4xl mx-auto">
          <h2 className="text-5xl md:text-6xl font-bold mb-6 text-gray-900">
            Generate Professional Quotes{" "}
            <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              10x Faster
            </span>
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Transform hours of manual estimating into minutes with AI. Chat naturally to build quotes,
            adjust pricing in real-time, and deliver professional proposals that win more business.
          </p>

          {/* CTA Buttons - Moved here */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <button
              onClick={async () => {
                setIsCheckoutLoading(true);
                try {
                  const response = await fetch('/api/stripe/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      planType: 'individual',
                      billingCycle: 'monthly',
                      additionalLicenses: 0,
                      trialPeriodDays: 14,
                    }),
                  });
                  
                  if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to create checkout');
                  }
                  
                  const { url } = await response.json();
                  if (url) {
                    window.location.href = url;
                  }
                } catch (error: any) {
                  console.error('Checkout error:', error);
                  alert(error.message || 'Failed to start checkout. Please try again.');
                  setIsCheckoutLoading(false);
                }
              }}
              disabled={isCheckoutLoading}
              className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all hover:shadow-lg font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCheckoutLoading ? 'Loading...' : 'Try For Free'}
            </button>
            <a
              href="https://calendly.com/quotetree/30min"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:shadow-md transition-all font-semibold text-lg text-center"
            >
              Book a Demo
            </a>
          </div>
        </div>

        {/* Video Placeholder - Made smaller */}
        <div className="max-w-4xl mx-auto mb-8">
          <div className="relative aspect-video bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl shadow-2xl overflow-hidden group cursor-pointer">
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-10">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
                  backgroundSize: "40px 40px",
                }}
              />
            </div>

            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                {/* Pulsing rings */}
                <div className="absolute inset-0 rounded-full bg-white/20 animate-ping" />
                <div className="absolute inset-0 rounded-full bg-white/10 animate-pulse" />
                
                {/* Play button */}
                <div className="relative w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                  <Play className="w-10 h-10 text-green-600 ml-1" fill="currentColor" />
                </div>
              </div>
            </div>

            {/* Text overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center -mt-32">
                <p className="text-white/90 text-2xl font-semibold mb-2">See QuoteTree in Action</p>
                <p className="text-white/70 text-sm">2 minute overview</p>
              </div>
            </div>
          </div>
        </div>

        {/* Feature bullets */}
        <div className="flex flex-wrap justify-center gap-8 text-gray-600">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span>Set up in under 5 minutes</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span>Cancel anytime</span>
          </div>
        </div>
      </section>

      {/* User Journey Section */}
      <section id="features" className="bg-gradient-to-b from-gray-50 to-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 text-gray-900">
              How QuoteTree Works
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              From conversation to professional quote in minutes. Here's your journey.
            </p>
          </div>

          <div className="grid lg:grid-cols-12 gap-8">
            {/* Sidebar steps */}
            <div className="lg:col-span-4 space-y-3">
              {userJourneySteps.map((step) => (
                <button
                  key={step.id}
                  onMouseEnter={() => setActiveStep(step.id)}
                  className={`w-full text-left p-6 rounded-xl transition-all duration-300 ${
                    activeStep === step.id
                      ? "bg-green-600 text-white shadow-xl scale-105"
                      : "bg-white text-gray-900 hover:bg-gray-50 shadow-md hover:shadow-lg"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                        activeStep === step.id
                          ? "bg-white text-green-600"
                          : "bg-green-100 text-green-600"
                      }`}
                    >
                      {step.id}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-1">{step.title}</h3>
                      <p
                        className={`text-sm ${
                          activeStep === step.id ? "text-green-50" : "text-gray-600"
                        }`}
                      >
                        {step.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Screenshot display */}
            <div className="lg:col-span-8">
              <div className="relative">
                {/* Browser chrome mockup */}
                <div className="bg-white rounded-lg shadow-2xl overflow-hidden border border-gray-200">
                  {/* Browser header */}
                  <div className="bg-gray-100 px-4 py-3 flex items-center gap-2 border-b border-gray-200">
                    <div className="flex gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                    </div>
                    <div className="flex-1 mx-4">
                      <div className="bg-white rounded px-3 py-1 text-sm text-gray-500 border border-gray-300">
                        quotetree.com/projects
                      </div>
                    </div>
                  </div>

                  {/* Screenshot content */}
                  <div className="bg-gray-50 p-8 min-h-[500px] flex items-center justify-center">
                    {userJourneySteps.map((step) => (
                      <div
                        key={step.id}
                        className={`transition-opacity duration-300 ${
                          activeStep === step.id ? "opacity-100" : "opacity-0 absolute"
                        }`}
                      >
                        <div className="bg-white rounded-lg shadow-md p-8 text-center">
                          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-green-600">{step.id}</span>
                          </div>
                          <h3 className="text-2xl font-bold mb-2 text-gray-900">{step.title}</h3>
                          <p className="text-gray-600 mb-6">{step.description}</p>
                          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-lg p-8">
                            <p className="text-sm text-gray-500 italic">
                              Screenshot placeholder - Actual interface screenshot will be displayed here
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 text-gray-900">
              Simple, Transparent Pricing
            </h2>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Choose the plan that fits your business. All plans include a free trial.
            </p>

            {/* Billing toggle */}
            <div className="inline-flex items-center gap-3 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setIsYearly(false)}
                className={`px-6 py-2 rounded-md font-medium transition-all ${
                  !isYearly
                    ? "bg-white text-gray-900 shadow-md"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setIsYearly(true)}
                className={`px-6 py-2 rounded-md font-medium transition-all ${
                  isYearly
                    ? "bg-white text-gray-900 shadow-md"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Annual
                <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                  Save 20%
                </span>
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Free Trial Card */}
            <div className="relative rounded-2xl p-8 bg-white text-gray-900 shadow-lg border-2 border-gray-200">
              <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2">Free Trial</h3>
                <p className="text-sm text-gray-600">
                  Perfect for trying out QuoteTree
                </p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold">$0</span>
                  <span className="text-lg text-gray-600">/forever</span>
                </div>
              </div>

              <button
                onClick={() => handleCheckout('individual', 14)}
                disabled={isCheckoutLoading}
                className="block w-full py-3 rounded-lg font-semibold text-center mb-6 transition-all bg-green-600 text-white hover:bg-green-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckoutLoading ? 'Loading...' : 'Start 14-Day Trial'}
              </button>

              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">3 quotes per month</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Basic AI chat assistant</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Standard product library</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">PDF quote generation</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Email support</span>
                </li>
              </ul>
            </div>

            {/* Single User Card */}
            <div className="relative rounded-2xl p-8 bg-green-600 text-white shadow-2xl scale-105 border-4 border-green-500">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-yellow-400 text-gray-900 px-4 py-1 rounded-full text-sm font-bold">
                MOST POPULAR
              </div>

              <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2">Single User</h3>
                <p className="text-sm text-green-100">
                  Ideal for independent contractors
                </p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold">${isYearly ? '79' : '97'}</span>
                  <span className="text-lg text-green-100">/month</span>
                </div>
                {isYearly && (
                  <>
                    <p className="text-sm text-green-100 mt-2 font-medium">Save $216/year</p>
                    <p className="text-sm mt-1 text-green-100">Billed $948 annually</p>
                  </>
                )}
              </div>

              <button
                onClick={() => handleCheckout('individual')}
                disabled={isCheckoutLoading}
                className="block w-full py-3 rounded-lg font-semibold text-center mb-6 transition-all bg-white text-green-600 hover:bg-green-50 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckoutLoading ? 'Loading...' : 'Get Started'}
              </button>

              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">Unlimited quotes</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">Advanced AI chat assistant</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">Full product library access</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">Custom price book</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">PDF & Excel export</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">Priority support</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">Chat history preservation</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-white" />
                  <span className="text-sm text-green-50">Custom markup presets</span>
                </li>
              </ul>
            </div>

            {/* Organization Card */}
            <div className="relative rounded-2xl p-8 bg-white text-gray-900 shadow-lg border-2 border-gray-200">
              <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2">Organization</h3>
                <p className="text-sm text-gray-600">
                  Best for growing teams
                </p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold">${isYearly ? '130' : '158'}</span>
                  <span className="text-lg text-gray-600">/month</span>
                </div>
                {isYearly && (
                  <>
                    <p className="text-sm text-green-600 mt-2 font-medium">Save $336/year</p>
                    <p className="text-sm mt-1 text-gray-600">
                      Billed ${(130 + additionalLicenses * 65) * 12} annually
                    </p>
                  </>
                )}
                {!isYearly && additionalLicenses > 0 && (
                  <p className="text-sm mt-1 text-gray-600">
                    ${158 + additionalLicenses * 79}/month total
                  </p>
                )}
                <p className="text-sm text-gray-500 mt-2">2 licenses included</p>
                <p className="text-sm text-gray-500">${isYearly ? '65' : '79'}/mo per additional license</p>
              </div>

              {/* License Selector */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Additional Licenses
                </label>
                <div className="flex items-center justify-between gap-4">
                  <button
                    onClick={() => setAdditionalLicenses(Math.max(0, additionalLicenses - 1))}
                    disabled={additionalLicenses === 0}
                    className="w-10 h-10 rounded-lg bg-white border-2 border-gray-300 text-gray-700 font-bold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    -
                  </button>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-gray-900">{additionalLicenses}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Total: {2 + additionalLicenses} licenses
                    </div>
                  </div>
                  <button
                    onClick={() => setAdditionalLicenses(additionalLicenses + 1)}
                    className="w-10 h-10 rounded-lg bg-white border-2 border-gray-300 text-gray-700 font-bold hover:bg-gray-100 flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
              </div>

              <button
                onClick={() => handleCheckout('organization')}
                disabled={isCheckoutLoading}
                className="block w-full py-3 rounded-lg font-semibold text-center mb-6 transition-all bg-green-600 text-white hover:bg-green-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckoutLoading ? 'Loading...' : 'Get Started'}
              </button>

              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Everything in Single User</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Up to 2 team members</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Shared price book</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Team collaboration</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Centralized quote log</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Admin dashboard</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">Bulk product import</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                  <span className="text-sm text-gray-600">API access</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 text-gray-900">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-gray-600">
              Everything you need to know about QuoteTree
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-200"
              >
                <button
                  onClick={() => setOpenFaqIndex(openFaqIndex === index ? null : index)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="font-semibold text-gray-900 pr-4">{faq.question}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform ${
                      openFaqIndex === index ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {openFaqIndex === index && (
                  <div className="px-6 pb-5">
                    <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-gradient-to-br from-green-600 to-emerald-600 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Ready to Transform Your Quoting Process?
          </h2>
          <p className="text-xl text-green-50 mb-8 max-w-2xl mx-auto">
            Join contractors and estimators who are saving hours every week with AI-powered quotes.
          </p>
          <Link
            href="/auth/signup"
            className="inline-block px-8 py-4 bg-white text-green-600 rounded-lg hover:bg-green-50 transition-all hover:shadow-2xl font-semibold text-lg"
          >
            Start Your Free Trial Today
          </Link>
          <p className="mt-4 text-green-100 text-sm">No credit card required • Set up in 5 minutes</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <Link href="/" className="flex items-center gap-1 mb-4">
                <Image
                  src="/quotetree-icon.svg"
                  alt="QuoteTree Logo"
                  width={56}
                  height={56}
                  className="w-14 h-14"
                />
                <h3 className="text-2xl font-medium text-green-700">QuoteTree</h3>
              </Link>
              <p className="text-gray-600 text-sm">
                AI-powered quote generation for modern contractors.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#" className="text-gray-600 hover:text-gray-900">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="#pricing" className="text-gray-600 hover:text-gray-900">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-gray-600 hover:text-gray-900">
                    Demo
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#" className="text-gray-600 hover:text-gray-900">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-gray-600 hover:text-gray-900">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-gray-600 hover:text-gray-900">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#" className="text-gray-600 hover:text-gray-900">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="#" className="text-gray-600 hover:text-gray-900">
                    Terms of Service
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-8 text-center text-gray-600 text-sm">
            <p>&copy; 2025 QuoteTree. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

