"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { X, Upload, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";

interface PersonalizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: (profile: {
    company_name: string | null;
    company_address: string | null;
    company_logo_url: string | null;
  }) => void;
}

export default function PersonalizationModal({
  isOpen,
  onClose,
  onUpdated,
}: PersonalizationModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const { canViewPersonalization } = useOrganizationRole();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);

  useEffect(() => {
    if (!logoPreview?.startsWith("blob:")) return;
    return () => {
      if (logoPreview && logoPreview.startsWith("blob:")) {
        URL.revokeObjectURL(logoPreview);
      }
    };
  }, [logoPreview]);

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      setInitializing(true);
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error) throw error;
        if (!user) {
          toast.error("You must be signed in to personalize your workspace.");
          return;
        }

        const { data, error: profileError } = await supabase
          .from("profiles")
          .select("company_name, company_address, company_logo_url")
          .eq("id", user.id)
          .single();

        if (profileError) throw profileError;

        if (mounted && data) {
          setCompanyName(data.company_name || "");
          setCompanyAddress(data.company_address || "");
          setLogoUrl(data.company_logo_url || null);
          setLogoPreview(data.company_logo_url || null);
          setLogoRemoved(false);
          setLogoFile(null);
        }
      } catch (error: any) {
        console.error("Failed to load personalization settings", error);
        toast.error(error.message || "Failed to load personalization settings");
      } finally {
        if (mounted) {
          setInitializing(false);
        }
      }
    };

    if (isOpen) {
      loadProfile();
    }

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, supabase]);

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload a valid image file");
      return;
    }

    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      toast.error("Logo must be 5MB or smaller");
      return;
    }

    if (logoPreview && logoPreview.startsWith("blob:")) {
      URL.revokeObjectURL(logoPreview);
    }

    const previewUrl = URL.createObjectURL(file);
    setLogoFile(file);
    setLogoPreview(previewUrl);
    setLogoRemoved(false);
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setLogoRemoved(true);
  };

  const handleSave = async () => {
    if (loading) return;

    setLoading(true);
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) {
        toast.error("You must be signed in to personalize your workspace.");
        return;
      }

      let uploadedLogoUrl: string | null = logoUrl;

      if (logoFile) {
        const fileExt = logoFile.name.split(".").pop() || "png";
        const fileName = `logos/${user.id}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("company-assets")
          .upload(fileName, logoFile, {
            cacheControl: "3600",
            upsert: true,
          });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = await supabase.storage
          .from("company-assets")
          .getPublicUrl(fileName);

        if (!publicUrlData?.publicUrl) {
          throw new Error("Failed to retrieve public URL for uploaded logo");
        }

        uploadedLogoUrl = publicUrlData.publicUrl;
      } else if (logoRemoved) {
        uploadedLogoUrl = null;
      }

      const updates = {
        company_name: companyName.trim() || null,
        company_address: companyAddress.trim() || null,
        company_logo_url: uploadedLogoUrl,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError, data: updatedProfile } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id)
        .select("company_name, company_address, company_logo_url")
        .single();

      if (updateError) throw updateError;

      setLogoUrl(uploadedLogoUrl);
      setLogoFile(null);
      setLogoRemoved(false);
      if (uploadedLogoUrl) {
        setLogoPreview(uploadedLogoUrl);
      }

      toast.success("Personalization updated");
      onUpdated?.({
        company_name: updatedProfile.company_name,
        company_address: updatedProfile.company_address,
        company_logo_url: updatedProfile.company_logo_url,
      });
      onClose();
    } catch (error: any) {
      console.error("Failed to save personalization", error);
      toast.error(error.message || "Failed to save personalization");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  // Check permission
  if (!canViewPersonalization()) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-6 py-8 text-center">
            <p className="text-gray-600">
              You don&apos;t have permission to access personalization settings.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Contact your organization owner or super admin for access.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Personalization</h2>
            <p className="text-sm text-gray-500">
              Customize the branding that appears on your quotes.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close personalization modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          {initializing ? (
            <div className="text-center text-sm text-gray-500 py-12">Loading settings...</div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Enter your company name"
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Company Logo
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg border border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden">
                    {logoPreview ? (
                      <Image
                        src={logoPreview}
                        alt="Company Logo"
                        width={80}
                        height={80}
                        className="object-contain"
                      />
                    ) : (
                      <span className="text-xs text-gray-400 text-center px-2">
                        No logo uploaded
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg cursor-pointer hover:bg-gray-800 transition-colors">
                      <Upload size={16} />
                      <span>Upload Logo</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoChange}
                      />
                    </label>
                    {(logoPreview || logoUrl) && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                        Remove
                      </button>
                    )}
                    <p className="text-xs text-gray-500">
                      Recommended: PNG, JPG, or SVG. Max 5MB.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Office Address
                </label>
                <textarea
                  value={companyAddress}
                  onChange={(event) => setCompanyAddress(event.target.value)}
                  rows={3}
                  placeholder="123 Main St, City, State ZIP"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
                />
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={loading || initializing}
          >
            {loading ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}


