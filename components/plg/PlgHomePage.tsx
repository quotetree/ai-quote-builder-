"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Search,
  BookOpen,
  FolderPlus,
  ExternalLink,
  HelpCircle,
  ChevronDown,
  Plus,
  Star,
  Newspaper,
} from "lucide-react";
import AuthPromptModal from "@/components/plg/AuthPromptModal";
import PriceBookModal from "@/components/PriceBookModal";

const CAPABILITIES = [
  {
    title: "Chat your way to a quote",
    description:
      "Describe the scope in plain language and QuoteTree pulls matching products from your price book.",
  },
  {
    title: "Keep price books accurate",
    description:
      "Upload and manage your catalog so every quote reflects your real products, labor rates, and margins.",
  },
  {
    title: "Projects that stay organized",
    description:
      "Chat history, product selections, and finished quotes live together in one project.",
  },
];

export default function PlgHomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectSort, setProjectSort] = useState<"recent" | "name">("recent");
  const [projectName, setProjectName] = useState("");
  const [projectInputFocused, setProjectInputFocused] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [priceBookOpen, setPriceBookOpen] = useState(false);
  const capabilitiesRef = useRef<HTMLDivElement | null>(null);
  const brandMenuRef = useRef<HTMLDivElement | null>(null);

  // Open sidebar on desktop by default; keep collapsed on small screens
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setSidebarOpen(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!capabilitiesOpen && !brandMenuOpen) return;

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        capabilitiesOpen &&
        capabilitiesRef.current &&
        !capabilitiesRef.current.contains(target)
      ) {
        setCapabilitiesOpen(false);
      }
      if (
        brandMenuOpen &&
        brandMenuRef.current &&
        !brandMenuRef.current.contains(target)
      ) {
        setBrandMenuOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCapabilitiesOpen(false);
        setBrandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [capabilitiesOpen, brandMenuOpen]);

  const openAuthModal = () => {
    setCapabilitiesOpen(false);
    setBrandMenuOpen(false);
    setAuthModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <AuthPromptModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
      <PriceBookModal
        isOpen={priceBookOpen}
        onClose={() => setPriceBookOpen(false)}
        guestPreview
        onRequireAuth={() => {
          openAuthModal();
        }}
      />
      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-gray-200 bg-[#f9f9f9] transition-all duration-300 ${
          sidebarOpen ? "w-64" : "w-14"
        }`}
      >
        <div
          className={`border-b border-gray-200 p-3 ${
            sidebarOpen ? "" : "flex flex-col items-center"
          }`}
        >
          <div
            className={`mb-4 flex items-center ${
              sidebarOpen ? "justify-between" : "justify-center"
            }`}
          >
            {sidebarOpen ? (
              <>
                <Link href="/" className="flex items-center" aria-label="QuoteTree home">
                  <Image
                    src="/quotetree-icon.svg"
                    alt="QuoteTree"
                    width={40}
                    height={40}
                    className="h-10 w-10 mix-blend-multiply"
                    priority
                  />
                </Link>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-lg p-1.5 transition-colors hover:bg-gray-200"
                  aria-label="Collapse sidebar"
                >
                  <SidebarToggleIcon />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-1.5 transition-colors hover:bg-gray-200"
                aria-label="Expand sidebar"
              >
                <SidebarToggleIcon />
              </button>
            )}
          </div>

          <div
            className={`space-y-1 ${
              sidebarOpen ? "" : "flex flex-col items-center"
            }`}
          >
            <button
              type="button"
              onClick={openAuthModal}
              className={`flex items-center gap-3 rounded-lg text-sm transition-colors hover:bg-gray-200 ${
                sidebarOpen ? "w-full px-3 py-2" : "p-2"
              }`}
              title="Search Projects"
            >
              <Search size={18} />
              {sidebarOpen && <span>Search Projects</span>}
            </button>

            <button
              type="button"
              onClick={() => setPriceBookOpen(true)}
              className={`flex items-center gap-3 rounded-lg text-sm transition-colors hover:bg-gray-200 ${
                sidebarOpen ? "w-full px-3 py-2" : "p-2"
              }`}
              title="Price Book"
            >
              <BookOpen size={18} />
              {sidebarOpen && <span>Price Book</span>}
            </button>

            <button
              type="button"
              onClick={openAuthModal}
              className={`flex items-center gap-3 rounded-lg bg-gray-200 text-sm ${
                sidebarOpen ? "w-full px-3 py-2" : "p-2"
              }`}
              title="New Project"
            >
              <FolderPlus size={18} />
              {sidebarOpen && <span>New Project</span>}
            </button>
          </div>
        </div>

        {sidebarOpen && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
            <div className="mb-2 space-y-2 px-3 shrink-0">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Projects
              </h3>
              <div
                className="flex rounded-md border border-gray-200 bg-white p-0.5"
                role="group"
                aria-label="Sort projects"
              >
                <button
                  type="button"
                  onClick={() => setProjectSort("recent")}
                  className={`flex-1 rounded py-1 text-[10px] font-medium ${
                    projectSort === "recent"
                      ? "bg-gray-200 text-gray-900"
                      : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  Recent
                </button>
                <button
                  type="button"
                  onClick={() => setProjectSort("name")}
                  className={`flex-1 rounded py-1 text-[10px] font-medium ${
                    projectSort === "name"
                      ? "bg-gray-200 text-gray-900"
                      : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  A–Z
                </button>
              </div>
            </div>
            <div className="px-3 py-2 text-sm text-gray-400">No projects yet</div>
          </div>
        )}

        {!sidebarOpen && <div className="flex-1" />}

        <div
          className={`mt-auto border-t border-gray-200 ${
            sidebarOpen ? "p-3" : "flex flex-col items-center p-2"
          }`}
        >
          {sidebarOpen ? (
            <>
              <div className="mb-3 space-y-0.5">
                <Link
                  href="/welcome#pricing"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
                >
                  <Star size={18} />
                  <span className="flex-1 text-left">See plans and pricing</span>
                  <ExternalLink size={14} className="text-gray-400" />
                </Link>
                <Link
                  href="/blog"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
                >
                  <Newspaper size={18} />
                  <span className="flex-1 text-left">Blog</span>
                  <ExternalLink size={14} className="text-gray-400" />
                </Link>
                <a
                  href="mailto:support@quotetree.com"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
                >
                  <HelpCircle size={18} />
                  <span className="flex-1 text-left">Help</span>
                  <ExternalLink size={14} className="text-gray-400" />
                </a>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-3">
                <p className="text-sm font-medium text-gray-900">
                  Get quotes tailored to you
                </p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  Log in to save projects, sync your price book, and keep chat
                  history and quotes in one place.
                </p>
                <button
                  type="button"
                  onClick={openAuthModal}
                  className="mt-3 flex w-full items-center justify-center rounded-full border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
                >
                  Log in
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={openAuthModal}
              className="rounded-lg p-2 transition-colors hover:bg-gray-200"
              title="Log in"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-[10px] font-medium text-white">
                …
              </div>
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main
        className={`flex min-h-screen flex-col transition-all duration-300 ${
          sidebarOpen ? "pl-64" : "pl-14"
        }`}
      >
        <header className="flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="relative" ref={brandMenuRef}>
            <button
              type="button"
              onClick={() => setBrandMenuOpen((open) => !open)}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-lg font-semibold text-gray-900 transition-colors hover:bg-gray-100"
              aria-expanded={brandMenuOpen}
            >
              QuoteTree
              <ChevronDown size={16} className="text-gray-500" />
            </button>
            {brandMenuOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                <Link
                  href="/welcome#features"
                  className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setBrandMenuOpen(false)}
                >
                  How it works
                </Link>
                <Link
                  href="/welcome#pricing"
                  className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setBrandMenuOpen(false)}
                >
                  Plans and pricing
                </Link>
                <Link
                  href="/blog"
                  className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setBrandMenuOpen(false)}
                >
                  Blog
                </Link>
                <a
                  href="https://calendly.com/quotetree/30min"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setBrandMenuOpen(false)}
                >
                  Book a demo
                </a>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openAuthModal}
              className="rounded-full bg-brand-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-green-dark"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={openAuthModal}
              className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
            >
              Sign up for free
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-8">
          <div className="w-full max-w-2xl text-center">
            <h1 className="mb-4 text-4xl font-semibold tracking-tight">
              New project
            </h1>
            <p className="mb-10 text-gray-500">
              Projects keep your chat history, product selections, and quotes
              all in one place.
            </p>

            <div className="mb-6">
              <div
                className={`rounded-2xl border bg-gray-100 transition-all ${
                  projectInputFocused
                    ? "border-gray-300"
                    : "border-transparent"
                }`}
              >
                <div className="relative">
                  <button
                    type="button"
                    onClick={openAuthModal}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    title="Attach files"
                    aria-label="Attach files"
                  >
                    <Plus size={20} />
                  </button>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    onFocus={(event) => {
                      setProjectInputFocused(true);
                      event.target.select();
                    }}
                    onBlur={() => {
                      if (!projectName.trim()) setProjectInputFocused(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        openAuthModal();
                      }
                    }}
                    placeholder={
                      projectInputFocused ? "" : "Project Name"
                    }
                    className="w-full rounded-2xl bg-transparent py-4 pl-12 pr-4 text-lg placeholder-gray-400 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={openAuthModal}
              className={`mb-6 w-full rounded-2xl py-4 text-lg font-medium text-white transition-colors ${
                projectName.trim()
                  ? "bg-brand-green hover:bg-brand-green-dark"
                  : "bg-gray-700 hover:bg-gray-800"
              }`}
            >
              Create project
            </button>

            <div className="relative inline-block" ref={capabilitiesRef}>
              <button
                type="button"
                onClick={() => setCapabilitiesOpen((open) => !open)}
                className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                Watch Demo
              </button>
              {capabilitiesOpen && (
                <div className="absolute left-1/2 top-full z-20 mt-3 w-[min(100vw-2rem,22rem)] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-xl">
                  <p className="mb-3 text-sm font-semibold text-gray-900">
                    QuoteTree helps you:
                  </p>
                  <ul className="space-y-3">
                    {CAPABILITIES.map((item) => (
                      <li key={item.title}>
                        <p className="text-sm font-medium text-gray-900">
                          {item.title}
                        </p>
                        <p className="text-xs leading-relaxed text-gray-500">
                          {item.description}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={openAuthModal}
                    className="mt-4 flex w-full items-center justify-center rounded-full bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black"
                  >
                    Sign up for free
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="px-6 pb-6 text-center text-xs leading-relaxed text-gray-400">
          QuoteTree uses AI to help build quotes. By using it, you agree to our{" "}
          <span className="underline decoration-gray-300">Terms</span> &{" "}
          <span className="underline decoration-gray-300">Privacy Policy</span>.
          Chats and documents may be processed to generate quotes.{" "}
          <Link href="/welcome#faq" className="underline decoration-gray-300 hover:text-gray-500">
            Learn more
          </Link>
          .
        </footer>
      </main>
    </div>
  );
}

function SidebarToggleIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-gray-700"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 8C3 7.44772 3.44772 7 4 7H20C20.5523 7 21 7.44772 21 8C21 8.55228 20.5523 9 20 9H4C3.44772 9 3 8.55228 3 8ZM3 16C3 15.4477 3.44772 15 4 15H14C14.5523 15 15 15.4477 15 16C15 16.5523 14.5523 17 14 17H4C3.44772 17 3 16.5523 3 16Z"
        fill="currentColor"
      />
    </svg>
  );
}
