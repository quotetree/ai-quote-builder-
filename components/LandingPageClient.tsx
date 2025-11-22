"use client";

import Link from "next/link";
import { useState } from "react";
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
      price: 245,
      period: "month",
      description: "Best for growing teams",
      features: [
        "Everything in Single User",
        "Up to 3 team members",
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
      price: 197,
      period: "month",
      yearlyTotal: 2364,
      description: "Best for growing teams",
      features: [
        "Everything in Single User",
        "Up to 3 team members",
        "Shared price book",
        "Team collaboration",
        "Centralized quote log",
        "Admin dashboard",
        "Bulk product import",
        "API access",
      ],
      cta: "Start Free Trial",
      highlighted: false,
      savings: "Save $576/year",
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
  const [isYearly, setIsYearly] = useState(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const currentPlans = isYearly ? pricingPlans.yearly : pricingPlans.monthly;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-green-600 to-green-700 rounded-lg flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5 text-white"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">QuoteTree</h1>
          </div>
          <div className="flex gap-4">
            <Link
              href="/auth/signin"
              className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors font-medium"
            >
              Login
            </Link>
            <Link
              href="/auth/signup"
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all hover:shadow-lg font-medium"
            >
              Sign Up
            </Link>
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
        </div>

        {/* Video Placeholder */}
        <div className="max-w-5xl mx-auto mb-8">
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

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <Link
            href="/auth/signup"
            className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all hover:shadow-lg font-semibold text-lg"
          >
            Start Free Trial
          </Link>
          <button className="px-8 py-4 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:shadow-md transition-all font-semibold text-lg">
            View Pricing
          </button>
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
      <section className="bg-gradient-to-b from-gray-50 to-white py-20">
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
            {currentPlans.map((plan, index) => (
              <div
                key={index}
                className={`relative rounded-2xl p-8 ${
                  plan.highlighted
                    ? "bg-green-600 text-white shadow-2xl scale-105 border-4 border-green-500"
                    : "bg-white text-gray-900 shadow-lg border-2 border-gray-200"
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-yellow-400 text-gray-900 px-4 py-1 rounded-full text-sm font-bold">
                    MOST POPULAR
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                  <p
                    className={`text-sm ${
                      plan.highlighted ? "text-green-100" : "text-gray-600"
                    }`}
                  >
                    {plan.description}
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-bold">${plan.price}</span>
                    <span
                      className={`text-lg ${
                        plan.highlighted ? "text-green-100" : "text-gray-600"
                      }`}
                    >
                      /{plan.period}
                    </span>
                  </div>
                  {(plan as any).savings && (
                    <p className="text-sm text-green-100 mt-2 font-medium">{(plan as any).savings}</p>
                  )}
                  {(plan as any).yearlyTotal && (
                    <p
                      className={`text-sm mt-1 ${
                        plan.highlighted ? "text-green-100" : "text-gray-600"
                      }`}
                    >
                      Billed ${(plan as any).yearlyTotal} annually
                    </p>
                  )}
                </div>

                <Link
                  href="/auth/signup"
                  className={`block w-full py-3 rounded-lg font-semibold text-center mb-6 transition-all ${
                    plan.highlighted
                      ? "bg-white text-green-600 hover:bg-green-50 shadow-lg"
                      : "bg-green-600 text-white hover:bg-green-700 shadow-md"
                  }`}
                >
                  {plan.cta}
                </Link>

                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle
                        className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                          plan.highlighted ? "text-white" : "text-green-600"
                        }`}
                      />
                      <span
                        className={`text-sm ${
                          plan.highlighted ? "text-green-50" : "text-gray-600"
                        }`}
                      >
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 bg-gray-50">
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
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-green-600 to-green-700 rounded-lg flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-5 h-5 text-white"
                  >
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900">QuoteTree</h3>
              </div>
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

