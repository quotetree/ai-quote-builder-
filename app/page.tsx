import Link from "next/link";
import { Zap, Clock, TrendingUp, CheckCircle } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-950">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            QuoteTree.ai
          </h1>
          <div className="flex gap-4">
            <Link
              href="/auth/signin"
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Login
            </Link>
            <Link
              href="/auth/signup"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Sign Up
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <h2 className="text-5xl md:text-6xl font-bold mb-6">
            Generate Professional Quotes in{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              10 Minutes
            </span>
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
            AI-powered quote builder that transforms estimating from hours of manual work
            into a streamlined conversation. Build, revise, and deliver professional quotes
            while you chat.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/auth/signup"
              className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-lg"
            >
              Get Started Free
            </Link>
            <button className="px-8 py-4 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors font-semibold text-lg">
              Watch Demo
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mb-4">
              <Zap className="text-blue-600" size={24} />
            </div>
            <h3 className="text-xl font-bold mb-3">AI-Powered Speed</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Reduce quote generation time by 80%. What took hours now takes minutes with intelligent AI assistance.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mb-4">
              <Clock className="text-purple-600" size={24} />
            </div>
            <h3 className="text-xl font-bold mb-3">Conversational Interface</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Chat naturally with AI to build quotes. Make revisions, adjust pricing, and refine estimates in real-time.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center mb-4">
              <TrendingUp className="text-green-600" size={24} />
            </div>
            <h3 className="text-xl font-bold mb-3">Profit Visibility</h3>
            <p className="text-gray-600 dark:text-gray-400">
              See real-time profit margins based on your price book. Make informed decisions before sending quotes.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 bg-white dark:bg-gray-900 rounded-2xl">
        <h2 className="text-4xl font-bold text-center mb-12">How It Works</h2>
        <div className="space-y-8">
          {[
            { step: "1", title: "Create a Project", desc: "Name your project and select product families" },
            { step: "2", title: "Describe the Scope", desc: "Chat with AI about your project requirements" },
            { step: "3", title: "Review & Refine", desc: "AI generates quote, you make adjustments conversationally" },
            { step: "4", title: "Export & Send", desc: "Download professional PDF and send to your client" },
          ].map((item) => (
            <div key={item.step} className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                {item.step}
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-gray-600 dark:text-gray-400">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-4xl font-bold mb-6">Ready to Transform Your Quoting Process?</h2>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-8 max-w-2xl mx-auto">
          Join contractors and estimators who are saving hours every week with QuoteTree.ai
        </p>
        <Link
          href="/auth/signup"
          className="inline-block px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-lg"
        >
          Start Free Trial
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-600 dark:text-gray-400">
          <p>&copy; 2025 QuoteTree.ai. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

