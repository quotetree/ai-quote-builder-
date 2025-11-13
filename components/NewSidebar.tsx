"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { 
  Menu, 
  X, 
  Search, 
  BookOpen, 
  FolderPlus,
  LogOut,
  ChevronRight
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import PriceBookModal from "./PriceBookModal";
import { useSidebar } from "@/contexts/SidebarContext";
import PersonalizationModal from "./PersonalizationModal";

interface NewSidebarProps {
  userEmail?: string;
  userName?: string;
}

export default function NewSidebar({ userEmail, userName }: NewSidebarProps) {
  const { isOpen, closeSidebar, openSidebar } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [priceBookOpen, setPriceBookOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [profile, setProfile] = useState<{
    company_name: string | null;
    company_address: string | null;
    company_logo_url: string | null;
  } | null>(null);
  const { projects, loading, fetchProjects } = useProjects();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountButtonRef = useRef<HTMLButtonElement | null>(null);

  // Refresh projects when pathname changes
  useEffect(() => {
    fetchProjects();
  }, [pathname]);

  // Listen for project update events
  useEffect(() => {
    const handleProjectUpdate = () => {
      fetchProjects();
    };
    
    window.addEventListener('projectUpdated', handleProjectUpdate);
    
    return () => {
      window.removeEventListener('projectUpdated', handleProjectUpdate);
    };
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("company_name, company_address, company_logo_url")
        .eq("id", user.id)
        .single();

      if (!error && data) {
        setProfile(data);
      }
    } catch (error) {
      console.error("Failed to load profile", error);
    }
  }, [supabase]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(target) &&
        accountButtonRef.current &&
        !accountButtonRef.current.contains(target)
      ) {
        setAccountMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setAccountMenuOpen(false);
    router.push("/");
  };

  const isHomePage = pathname === "/dashboard" || pathname === "/projects/new";

  return (
    <>
      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen bg-[#f9f9f9] border-r border-gray-200 transition-all duration-300 z-40 flex flex-col ${
          isOpen ? "w-64" : "w-14"
        }`}
      >
        {/* Header Section */}
        <div className={`p-3 border-b border-gray-200 ${isOpen ? "" : "flex flex-col items-center"}`}>
          <div className={`flex items-center ${isOpen ? "justify-between mb-4" : "justify-center mb-3"}`}>
            {/* Logo / Toggle Button */}
            {isOpen ? (
              <>
                <div className="flex items-center gap-2">
                  <Image
                    src="/quotetree-icon.svg"
                    alt="QuoteTree Logo"
                    width={40}
                    height={40}
                    className="w-10 h-10 mix-blend-multiply"
                    style={{ background: 'transparent' }}
                    priority
                  />
                </div>
                <button
                  onClick={closeSidebar}
                  className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                  aria-label="Close sidebar"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="text-gray-700"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M3 8C3 7.44772 3.44772 7 4 7H20C20.5523 7 21 7.44772 21 8C21 8.55228 20.5523 9 20 9H4C3.44772 9 3 8.55228 3 8ZM3 16C3 15.4477 3.44772 15 4 15H14C14.5523 15 15 15.4477 15 16C15 16.5523 14.5523 17 14 17H4C3.44772 17 3 16.5523 3 16Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </>
            ) : (
              <button
                onClick={openSidebar}
                className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                aria-label="Open sidebar"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-gray-700"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M3 8C3 7.44772 3.44772 7 4 7H20C20.5523 7 21 7.44772 21 8C21 8.55228 20.5523 9 20 9H4C3.44772 9 3 8.55228 3 8ZM3 16C3 15.4477 3.44772 15 4 15H14C14.5523 15 15 15.4477 15 16C15 16.5523 14.5523 17 14 17H4C3.44772 17 3 16.5523 3 16Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Navigation Items */}
          <div className={`space-y-1 ${isOpen ? "" : "flex flex-col items-center"}`}>
            <button
              onClick={() => setSearchOpen(true)}
              className={`flex items-center gap-3 rounded-lg hover:bg-gray-200 transition-colors text-sm ${
                isOpen ? "w-full px-3 py-2" : "p-2"
              }`}
              title="Search Projects"
            >
              <Search size={18} />
              {isOpen && <span>Search Projects</span>}
            </button>

            <button
              onClick={() => setPriceBookOpen(true)}
              className={`flex items-center gap-3 rounded-lg hover:bg-gray-200 transition-colors text-sm ${
                isOpen ? "w-full px-3 py-2" : "p-2"
              }`}
              title="Price Book"
            >
              <BookOpen size={18} />
              {isOpen && <span>Price Book</span>}
            </button>

            <button
              onClick={() => router.push("/dashboard")}
              className={`flex items-center gap-3 rounded-lg transition-colors text-sm ${
                isOpen ? "w-full px-3 py-2" : "p-2"
              } ${isHomePage ? "bg-gray-200" : "hover:bg-gray-200"}`}
              title="New Project"
            >
              <FolderPlus size={18} />
              {isOpen && <span>New Project</span>}
            </button>
          </div>
        </div>

        {/* Projects List Section - Only show when open */}
        {isOpen && (
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <div className="px-3 mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Projects
              </h3>
            </div>
            {loading ? (
              <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
            ) : projects.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">No projects yet</div>
            ) : (
              <div className="space-y-0.5">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => router.push(`/projects/${project.id}`)}
                    className={`w-full text-left px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm truncate ${
                      pathname === `/projects/${project.id}` ? "bg-gray-200" : ""
                    }`}
                  >
                    {project.project_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Spacer to push user section to bottom when collapsed */}
        {!isOpen && <div className="flex-1" />}

        {/* User Profile Section */}
        <div className={`border-t border-gray-200 ${isOpen ? "p-3" : "p-2 flex flex-col items-center"}`}>
          {isOpen ? (
            <>
              <div className="mb-3">
                <button
                  ref={accountButtonRef}
                  onClick={() => setAccountMenuOpen((prev) => !prev)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
                    {userName?.charAt(0).toUpperCase() || userEmail?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {profile?.company_name || userName || userEmail}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {userEmail}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`text-gray-400 transition-transform ${accountMenuOpen ? "rotate-90" : ""}`}
                  />
                </button>
                <div className="flex items-center justify-between px-3 mt-2">
                  <span className="text-xs text-gray-500">Free</span>
                  <button className="text-xs px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100 transition-colors">
                    Upgrade
                  </button>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-sm"
              >
                <LogOut size={16} />
                <span>Sign Out</span>
              </button>
            </>
          ) : (
            <button
              ref={accountButtonRef}
              onClick={() => setAccountMenuOpen((prev) => !prev)}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title={userName || userEmail || "User"}
            >
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-medium">
                {userName?.charAt(0).toUpperCase() || userEmail?.charAt(0).toUpperCase() || "U"}
              </div>
            </button>
          )}
        </div>
      </aside>

      {accountMenuOpen && (
        <div
          ref={accountMenuRef}
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 w-72"
          style={{
            left: isOpen ? 24 : 68,
            bottom: 120,
          }}
        >
          <div className="px-4 py-3 border-b border-gray-200">
            <p className="text-sm font-semibold text-gray-900">
              {profile?.company_name || userName || "Workspace"}
            </p>
            <p className="text-xs text-gray-500 truncate">{userEmail}</p>
          </div>
          <div className="py-2">
            <button
              onClick={() => {
                setAccountMenuOpen(false);
                setPersonalizationOpen(true);
              }}
              className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span>Personalization</span>
              <ChevronRight size={14} className="text-gray-400" />
            </button>
            <button
              disabled
              className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
            >
              <span>Workspace settings</span>
              <span className="text-xs uppercase tracking-wide">Soon</span>
            </button>
            <button
              disabled
              className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
            >
              <span>Add teammates</span>
              <span className="text-xs uppercase tracking-wide">Soon</span>
            </button>
          </div>
        </div>
      )}

      {/* Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4">
            <div className="p-4 border-b border-gray-200 flex items-center gap-3">
              <Search size={20} className="text-gray-400" />
              <input
                type="text"
                placeholder="Search projects..."
                className="flex-1 bg-transparent border-none outline-none text-lg"
                autoFocus
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-4">
              {projects.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No projects found
                </div>
              ) : (
                <div className="space-y-2">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => {
                        router.push(`/projects/${project.id}`);
                        setSearchOpen(false);
                      }}
                      className="w-full text-left p-3 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <h4 className="font-medium">{project.project_name}</h4>
                      <p className="text-sm text-gray-500">
                        Created {new Date(project.created_at).toLocaleDateString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Price Book Modal */}
      <PriceBookModal
        isOpen={priceBookOpen}
        onClose={() => setPriceBookOpen(false)}
      />

      <PersonalizationModal
        isOpen={personalizationOpen}
        onClose={() => setPersonalizationOpen(false)}
        onUpdated={(updated) => {
          setProfile(updated);
        }}
      />
    </>
  );
}

