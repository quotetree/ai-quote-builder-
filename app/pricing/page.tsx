"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Home, ChevronRight } from "lucide-react";
import PricingCards from "@/components/pricing/PricingCards";
import BlogAuthActions from "@/components/blog/BlogAuthActions";
import AuthPromptModal from "@/components/plg/AuthPromptModal";
import { Toaster } from "react-hot-toast";

export default function PricingPage() {
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <Toaster position="top-center" />
      <AuthPromptModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
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
          <div className="flex items-center gap-6">
            <Link
              href="/blog"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 hidden sm:inline"
            >
              Blog
            </Link>
            <BlogAuthActions />
          </div>
        </nav>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link
            href="/"
            className="hover:text-green-600 transition-colors flex items-center gap-1"
          >
            <Home className="w-4 h-4" />
            <span>Home</span>
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-gray-900 font-medium">Pricing</span>
        </div>
      </div>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 pb-24">
        <PricingCards />
      </section>

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
                  <Link href="/welcome#features" className="text-gray-600 hover:text-gray-900">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="/pricing" className="text-gray-600 hover:text-gray-900">
                    Pricing
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/blog" className="text-gray-600 hover:text-gray-900">
                    Blog
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-200 pt-8 text-center text-gray-600 text-sm">
            <p>&copy; {new Date().getFullYear()} QuoteTree. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
