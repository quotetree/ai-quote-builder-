"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, KeyRound, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";
import type { ApiKeyPermission } from "@/lib/apiKeys/permissions";

interface ApiKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ApiKeyStatus = "active" | "revoked";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_by: string | null;
  created_by_label: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  status: ApiKeyStatus;
  permissions: ApiKeyPermission[];
}

const GRANT_OPTIONS: { permission: ApiKeyPermission; label: string; chip: string }[] = [
  { permission: "quotes:create", label: "Create quotes", chip: "Create" },
  { permission: "quotes:update", label: "Update quotes", chip: "Update" },
  { permission: "quotes:delete", label: "Delete quotes", chip: "Delete" },
];

export default function ApiKeysModal({ isOpen, onClose }: ApiKeysModalProps) {
  const { organizationId, isOwner, isSuperAdmin } = useOrganizationRole();
  const canManage = isOwner() || isSuperAdmin();

  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [maxKeys, setMaxKeys] = useState(5);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPermissions, setNewKeyPermissions] = useState<ApiKeyPermission[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const activeKeys = useMemo(
    () => keys.filter((k) => k.status === "active"),
    [keys]
  );
  const revokedKeys = useMemo(
    () => keys.filter((k) => k.status === "revoked"),
    [keys]
  );
  const activeCount = activeKeys.length;
  const atCap = activeCount >= maxKeys;

  const resetEphemeral = useCallback(() => {
    setRevealedSecret(null);
    setShowCreateForm(false);
    setNewKeyName("");
    setNewKeyPermissions([]);
  }, []);

  const toggleNewKeyPermission = (permission: ApiKeyPermission, checked: boolean) => {
    setNewKeyPermissions((current) =>
      checked ? [...current, permission] : current.filter((p) => p !== permission)
    );
  };

  const handleClose = () => {
    resetEphemeral();
    setShowRevoked(false);
    onClose();
  };

  const loadKeys = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/api-keys`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load API keys");
      }
      setKeys(data.keys ?? []);
      if (typeof data.max_keys === "number") {
        setMaxKeys(data.max_keys);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load API keys";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (isOpen && canManage) {
      resetEphemeral();
      setShowRevoked(false);
      loadKeys();
    }
  }, [isOpen, canManage, loadKeys, resetEphemeral]);

  async function handleCreate() {
    if (!organizationId || atCap) return;
    const name = newKeyName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/api-keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, permissions: newKeyPermissions }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create API key");
      }

      setRevealedSecret(data.key);
      setShowCreateForm(false);
      setNewKeyName("");
      setNewKeyPermissions([]);
      toast.success("API key created");
      await loadKeys();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create API key";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKeyRow) {
    if (!organizationId) return;
    const confirmed = window.confirm(
      `Revoke “${key.name}”? It will stop working immediately.`
    );
    if (!confirmed) return;

    setRevokingId(key.id);
    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/api-keys/${key.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to revoke API key");
      }
      toast.success("API key revoked");
      await loadKeys();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to revoke API key";
      toast.error(message);
    } finally {
      setRevokingId(null);
    }
  }

  async function copySecret() {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  if (!isOpen) return null;

  if (!canManage) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
            <button
              onClick={handleClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-6 py-8 text-center">
            <p className="text-gray-600">
              Only organization owners and super admins can manage API keys.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
            <button
              onClick={handleClose}
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">API Keys</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Integrations · {activeCount} of {maxKeys} active keys
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

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {revealedSecret && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">
                Copy your API key now. For security, you won&apos;t be able to
                view it again.
              </p>
              <div className="mt-3 flex items-stretch gap-2">
                <code className="flex-1 text-xs sm:text-sm font-mono bg-white border border-amber-200 rounded-lg px-3 py-2 break-all text-gray-900">
                  {revealedSecret}
                </code>
                <button
                  type="button"
                  onClick={copySecret}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Copy size={14} />
                  Copy
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRevealedSecret(null)}
                className="mt-3 text-xs font-medium text-amber-900 underline hover:no-underline"
              >
                Done — I&apos;ve saved my key
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-gray-600">
              Connect QuoteTree to other apps and services using an API key.
              Keys stay active until you revoke them.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              disabled={atCap}
              title={
                atCap
                  ? `Limit of ${maxKeys} active keys reached`
                  : "Create new API key"
              }
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${
                atCap
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-gray-900 text-white hover:bg-gray-800"
              }`}
            >
              <Plus size={16} />
              Create new key
            </button>
          </div>

          {showCreateForm && (
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Key name
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Zapier production"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-400"
                  autoFocus
                />
              </label>
              <fieldset className="space-y-2" disabled={creating}>
                <legend className="text-sm font-medium text-gray-700">Grants</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {GRANT_OPTIONS.map(({ permission, label }) => (
                    <label
                      key={permission}
                      className="inline-flex items-center gap-2 min-h-8 text-sm text-gray-900 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={newKeyPermissions.includes(permission)}
                        onChange={(e) => toggleNewKeyPermission(permission, e.target.checked)}
                        className="h-4 w-4 accent-gray-900"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  Every key can read quotes. Leave all three unchecked for a read-only key. Grants cannot be changed later.
                </p>
              </fieldset>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewKeyName("");
                    setNewKeyPermissions([]);
                  }}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !newKeyName.trim()}
                  className="px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900" />
              <p className="mt-4 text-sm text-gray-500">Loading API keys…</p>
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <KeyRound size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No API keys yet.</p>
              <p className="text-xs mt-1">
                Create a key to integrate Quote Tree with other systems.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeKeys.length > 0 ? (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                  {activeKeys.map((key) => (
                    <KeyRow
                      key={key.id}
                      keyRow={key}
                      revokingId={revokingId}
                      onRevoke={handleRevoke}
                    />
                  ))}
                </ul>
              ) : (
                <div className="text-center py-8 text-gray-500 border border-dashed border-gray-200 rounded-lg">
                  <p className="text-sm">No active API keys.</p>
                </div>
              )}

              {revokedKeys.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRevoked((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    {showRevoked ? (
                      <ChevronDown size={16} className="text-gray-400" />
                    ) : (
                      <ChevronRight size={16} className="text-gray-400" />
                    )}
                    {showRevoked ? "Hide" : "Show"} revoked keys (
                    {revokedKeys.length})
                  </button>
                  {showRevoked && (
                    <ul className="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                      {revokedKeys.map((key) => (
                        <KeyRow
                          key={key.id}
                          keyRow={key}
                          revokingId={revokingId}
                          onRevoke={handleRevoke}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyRow({
  keyRow,
  revokingId,
  onRevoke,
}: {
  keyRow: ApiKeyRow;
  revokingId: string | null;
  onRevoke: (key: ApiKeyRow) => void;
}) {
  return (
    <li className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 text-sm truncate">
            {keyRow.name}
          </span>
          <StatusBadge status={keyRow.status} />
        </div>
        <p className="text-xs text-gray-500 mt-1 font-mono">
          {keyRow.key_prefix}…
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {keyRow.permissions.length === 0 ? (
            <span className="text-xs text-gray-500">Read-only</span>
          ) : (
            GRANT_OPTIONS.filter((g) => keyRow.permissions.includes(g.permission)).map((g) => (
              <span
                key={g.permission}
                className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-[11px] font-medium"
              >
                {g.chip}
              </span>
            ))
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Created by {keyRow.created_by_label ?? "a former member"} ·{" "}
          {formatDate(keyRow.created_at)}
        </p>
        {keyRow.status === "active" && (
          <p className="text-xs text-gray-500 mt-0.5">
            Last used {formatLastUsed(keyRow.last_used_at)}
          </p>
        )}
      </div>
      {keyRow.status === "active" && (
        <button
          type="button"
          onClick={() => onRevoke(keyRow)}
          disabled={revokingId === keyRow.id}
          className="text-sm font-medium text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors self-start sm:self-center disabled:opacity-50"
        >
          {revokingId === keyRow.id ? "Revoking…" : "Revoke"}
        </button>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: ApiKeyStatus }) {
  const styles =
    status === "active"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-red-50 text-red-700 border-red-200";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${styles}`}
    >
      {status}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatLastUsed(iso: string | null): string {
  if (!iso) return "never";
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const seconds = Math.max(0, Math.floor((now - then) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    }
    const days = Math.floor(hours / 24);
    if (days < 30) {
      return days === 1 ? "1 day ago" : `${days} days ago`;
    }
    return formatDate(iso);
  } catch {
    return "never";
  }
}
