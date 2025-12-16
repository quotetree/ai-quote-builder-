"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import toast from "react-hot-toast";

interface NewsletterSignupProps {
  inline?: boolean;
}

export default function NewsletterSignup({ inline = false }: NewsletterSignupProps) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast.error("Please enter your email address");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsSubmitting(true);

    // TODO: Integrate with your email service provider (e.g., Mailchimp, ConvertKit, Resend)
    // For now, just show a success message
    setTimeout(() => {
      toast.success("Thanks for subscribing! We'll keep you updated.");
      setEmail("");
      setIsSubmitting(false);
    }, 1000);
  };

  if (inline) {
    return (
      <div className="bg-gradient-to-br from-green-600 to-emerald-600 rounded-xl p-8 text-white my-12">
        <div className="max-w-2xl mx-auto text-center">
          <h3 className="text-2xl font-bold mb-3">Get QuoteTree Updates</h3>
          <p className="text-green-50 mb-6">
            Join contractors and estimators getting tips, guides, and product updates delivered to their inbox.
          </p>
          
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email address"
              className="flex-1 px-4 py-3 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-white"
              disabled={isSubmitting}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 bg-white text-green-600 rounded-lg font-semibold hover:bg-green-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isSubmitting ? "Subscribing..." : "Subscribe"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center">
          <Mail className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Get Updates</h3>
      </div>
      
      <p className="text-gray-600 mb-4 text-sm">
        Subscribe to get the latest tips, guides, and QuoteTree updates.
      </p>
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email"
          className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-green-600 transition-colors"
          disabled={isSubmitting}
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full px-4 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Subscribing..." : "Subscribe"}
        </button>
      </form>
      
      <p className="text-xs text-gray-500 mt-3">
        No spam. Unsubscribe anytime.
      </p>
    </div>
  );
}

