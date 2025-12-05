"use client";

import Link from "next/link";
import { CheckCircle, Mail } from "lucide-react";

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Success Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          {/* Success Icon */}
          <div className="mb-6 flex justify-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Payment Successful!
          </h1>

          {/* Message */}
          <p className="text-gray-600 mb-6">
            Your subscription has been activated. We've sent a welcome email with instructions to set up your password.
          </p>

          {/* Email Icon */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
            <Mail className="w-8 h-8 text-blue-600 mx-auto mb-2" />
            <p className="text-sm text-gray-700 font-medium">
              Check your email
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Click the link in your email to set your password and access your account
            </p>
          </div>

          {/* Next Steps */}
          <div className="text-left bg-gray-50 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Next Steps:</h3>
            <ol className="text-sm text-gray-600 space-y-2">
              <li className="flex items-start">
                <span className="font-bold mr-2">1.</span>
                <span>Check your email inbox (and spam folder)</span>
              </li>
              <li className="flex items-start">
                <span className="font-bold mr-2">2.</span>
                <span>Click the "Set Your Password" link</span>
              </li>
              <li className="flex items-start">
                <span className="font-bold mr-2">3.</span>
                <span>Create a secure password</span>
              </li>
              <li className="flex items-start">
                <span className="font-bold mr-2">4.</span>
                <span>Log in and start creating quotes!</span>
              </li>
            </ol>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <Link
              href="/auth/signin"
              className="block w-full py-3 px-6 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors"
            >
              Go to Login
            </Link>
            <Link
              href="/"
              className="block w-full py-3 px-6 bg-white text-gray-700 border-2 border-gray-300 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
            >
              Back to Home
            </Link>
          </div>

          {/* Help Text */}
          <p className="text-xs text-gray-500 mt-6">
            Didn't receive the email?{" "}
            <Link href="/auth/reset-password" className="text-green-600 hover:underline">
              Request a new one
            </Link>
          </p>
        </div>

        {/* Support Note */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Need help? Contact us at{" "}
          <a href="mailto:support@quotetree.com" className="text-green-600 hover:underline">
            support@quotetree.com
          </a>
        </p>
      </div>
    </div>
  );
}

