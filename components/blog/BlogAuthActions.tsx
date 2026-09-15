"use client";

import { useState } from "react";
import AuthPromptModal from "@/components/plg/AuthPromptModal";

/** Top-right Log in / Sign up pills that open the PLG auth modal. */
export default function BlogAuthActions() {
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAuthOpen(true)}
          className="rounded-full bg-brand-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-green-dark"
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setAuthOpen(true)}
          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
        >
          Sign up for free
        </button>
      </div>
      <AuthPromptModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}
