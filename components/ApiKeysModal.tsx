"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Plus, Copy, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";

interface ApiKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ApiKeyStatus = "active" | "expired" | "revoked";

interface ApiKeyListItem {
  id: string;
  name: string;
  key_prefix: string;
  created_by: string | null;
  created_by_label: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  status: ApiKeyStatus;
}

const STATUS_BADGE: Record<ApiKeyStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-800" },
  expired: { label: "Expired", className: "bg-amber-100 text-amber-800" },
  revoked: { label: "Revoked", className: "bg-gray-100 text-gray-600" },
};

export default function ApiKeysModal({ isOpen, onClose }: ApiKeysModalProps) {
  const { organizationId } = useOrganizationRole();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [maxKeys, setMaxKeys] = useState<number | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  // The plaintext secret lives only here, and only until the reveal panel is dismissed
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/api-keys`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load API keys");
      }
      setKeys(data.keys || []);
      setMaxKeys(data.max_keys ?? null);
    } catch (error: any) {
      console.error("Failed to load API keys:", error);
      setLoadError(error.message || "Failed to load API keys");
      toast.error(error.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (isOpen) {
      loadKeys();
    } else {
      setRevealedKey(null);
      setNewKeyName("");
    }
  }, [isOpen, loadKeys]);

  const liveKeyCount = keys.filter((k) => k.status === "active").length;
  const atCap = maxKeys !== null && liveKeyCount >= maxKeys;

  const handleClose = () => {
    setRevealedKey(null);
    setNewKeyName("");
    onClose();
  };

  const handleCreateKey = async () => {
    if (!organizationId) return;
    const name = newKeyName.trim();
    if (!name) {
      toast.error("Enter a name for the key");
      return;
    }

    setCreating(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Failed to create API key", { duration: 5000 });
        return;
      }
      setRevealedKey(data.key);
      setNewKeyName("");
      await loadKeys();
    } catch (error: any) {
      console.error("Failed to create API key:", error);
      toast.error(error.message || "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyKey = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success("API key copied to clipboard");
    } catch (error) {
      console.error("Failed to copy API key:", error);
      toast.error("Could not copy. Select the key and copy it manually.");
    }
  };

  const handleRevokeKey = async (key: ApiKeyListItem) => {
    if (!organizationId) return;

    if (!confirm(`Revoke the API key "${key.name}"? Any integration using it will stop working immediately.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/organizations/${organizationId}/api-keys/${key.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to revoke API key");
      }
      toast.success("API key revoked");
      await loadKeys();
    } catch (error: any) {
      console.error("Failed to revoke API key:", error);
      toast.error(error.message || "Failed to revoke API key");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col safe-area-bottom">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">API keys</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {maxKeys !== null
                ? `${liveKeyCount} of ${maxKeys} live keys · keys expire 90 days after creation`
                : "Keys expire 90 days after creation"}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close API keys modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* One-time secret reveal */}
          {revealedKey && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-green-700 mt-0.5 flex-shrink-0" size={20} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-green-900">Copy your new API key now</p>
                  <p className="text-sm text-green-800 mt-1">
                    This is the only time you will see this key. Store it somewhere safe. If you lose it,
                    revoke it and create a new one.
                  </p>
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <code
                      className="flex-1 min-w-0 block px-3 py-2 bg-white border border-green-200 rounded-lg font-mono text-xs text-gray-900 break-all select-all"
                      data-testid="api-key-secret"
                    >
                      {revealedKey}
                    </code>
                    <button
                      onClick={handleCopyKey}
                      className="flex items-center justify-center gap-2 px-4 py-2 min-h-11 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors"
                    >
                      <Copy size={16} />
                      Copy
                    </button>
                  </div>
                  <button
                    onClick={() => setRevealedKey(null)}
                    className="mt-3 px-4 py-2 min-h-11 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    I have saved this key
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Create form */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !atCap && !creating) {
                  e.preventDefault();
                  handleCreateKey();
                }
              }}
              maxLength={100}
              placeholder="Key name, for example: Accounting sync"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
            <button
              onClick={handleCreateKey}
              disabled={atCap || creating || !organizationId}
              title={atCap ? `Your organization has reached the limit of ${maxKeys} live API keys. Revoke one to create another.` : ""}
              className="flex items-center justify-center gap-2 px-4 py-2 min-h-11 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              <Plus size={18} />
              {creating ? "Creating..." : "New key"}
            </button>
          </div>

          {loading && keys.length === 0 ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900"></div>
              <p className="mt-4 text-sm text-gray-500">Loading API keys...</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <div className="min-w-[760px]">
                {/* Table Header */}
                <div className="bg-gray-50 border-b border-gray-200 px-6 py-3">
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-3 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Name
                    </div>
                    <div className="col-span-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Prefix
                    </div>
                    <div className="col-span-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Created by
                    </div>
                    <div className="col-span-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Expires
                    </div>
                    <div className="col-span-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Status
                    </div>
                    <div className="col-span-1"></div>
                  </div>
                </div>

                {/* Table Body */}
                <div className="divide-y divide-gray-200 bg-white">
                  {loadError && keys.length === 0 ? (
                    <div className="px-6 py-12 text-center">
                      <p className="text-sm text-red-600">{loadError}</p>
                    </div>
                  ) : keys.length === 0 ? (
                    <div className="px-6 py-12 text-center">
                      <p className="text-sm text-gray-500">No API keys yet</p>
                    </div>
                  ) : (
                    keys.map((key) => {
                      const badge = STATUS_BADGE[key.status];
                      return (
                        <div key={key.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                          <div className="grid grid-cols-12 gap-4 items-center">
                            <div className="col-span-3 min-w-0">
                              <p className="font-medium text-gray-900 truncate" title={key.name}>
                                {key.name}
                              </p>
                            </div>
                            <div className="col-span-2 min-w-0">
                              <span className="font-mono text-xs text-gray-700">{key.key_prefix}...</span>
                            </div>
                            <div className="col-span-2 min-w-0">
                              <span className="text-sm text-gray-600 truncate block">
                                {key.created_by_label || "Unknown"}
                              </span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-sm text-gray-600">{formatDate(key.expires_at)}</span>
                            </div>
                            <div className="col-span-2">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </div>
                            <div className="col-span-1 flex justify-end">
                              {key.status !== "revoked" && (
                                <button
                                  onClick={() => handleRevokeKey(key)}
                                  className="px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                                >
                                  Revoke
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500">
            API keys give read access to this organization&apos;s quotes through the QuoteTree API. Send a
            key in the <code className="font-mono">Authorization: Bearer</code> header or the{" "}
            <code className="font-mono">X-API-Key</code> header.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end bg-white">
          <button
            onClick={handleClose}
            className="px-4 py-2 min-h-11 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
