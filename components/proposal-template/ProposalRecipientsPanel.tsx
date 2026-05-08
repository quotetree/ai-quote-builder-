"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Edit2, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { ProposalRecipient, signerColor } from "./proposalTemplateTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
}

interface Props {
  recipients: ProposalRecipient[];
  onChange: (recipients: ProposalRecipient[]) => void;
  organizationId?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(r: ProposalRecipient) {
  const f = r.first_name?.[0] ?? "";
  const l = r.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || (r.email[0]?.toUpperCase() ?? "?");
}

function fullName(r: ProposalRecipient) {
  return `${r.first_name} ${r.last_name}`.trim() || r.email;
}


function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ─── Recipient Settings Popup ─────────────────────────────────────────────────

interface RecipientSettingsProps {
  recipient: ProposalRecipient;
  index: number;
  onEdit: () => void;
  onChangeSigner: () => void;
  onRemove: () => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

function RecipientSettingsPopup({
  recipient, index, onEdit, onChangeSigner, onRemove, onClose, anchorRef,
}: RecipientSettingsProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose, anchorRef]);

  return (
    <div
      ref={popupRef}
      className="absolute left-0 top-full mt-1 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          style={{ backgroundColor: signerColor(index) }}
        >
          {initials(recipient)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {fullName(recipient)}{" "}
            <span className={`text-xs font-medium ${recipient.role === "signer" ? "text-red-500" : "text-gray-500"}`}>
              {recipient.role === "signer" ? "Signer" : "CC"}
            </span>
          </p>
          <p className="text-xs text-gray-500 truncate">{recipient.email}</p>
        </div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 flex-shrink-0">
          <X size={14} />
        </button>
      </div>

      {/* Actions */}
      <div className="py-1">
        <button
          onClick={onEdit}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <Edit2 size={15} className="text-gray-400" />
          Edit personal details
        </button>
        <button
          onClick={onChangeSigner}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <Users size={15} className="text-gray-400" />
          Change signer
        </button>
        <button
          onClick={onRemove}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <Trash2 size={15} />
          Remove from document
        </button>
      </div>
    </div>
  );
}

// ─── Change Signer Modal ──────────────────────────────────────────────────────

interface ChangeSignerModalProps {
  replacing: ProposalRecipient;
  excludeEmails: string[];
  onConfirm: (newData: Omit<ProposalRecipient, "id">) => void;
  onCancel: () => void;
}

function ChangeSignerModal({ replacing, excludeEmails, onConfirm, onCancel }: ChangeSignerModalProps) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<SavedContact | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch contacts on query change
  useEffect(() => {
    if (!showDropdown) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/firma/contacts?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setContacts(data.contacts ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query, showDropdown]);

  // Close dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const filteredContacts = contacts.filter(
    (c) => !excludeEmails.includes(c.email.toLowerCase())
  );

  const handleSelectContact = (c: SavedContact) => {
    setSelected(c);
    setQuery(`${c.first_name} ${c.last_name}`.trim());
    setShowDropdown(false);
  };

  const handleChange = () => {
    if (!selected) return;
    onConfirm({
      first_name: selected.first_name,
      last_name: selected.last_name,
      email: selected.email,
      phone: selected.phone,
      role: replacing.role,
    });
  };

  const handleNewSignerSave = (data: Omit<ProposalRecipient, "id">) => {
    // Save to contacts for future autocomplete
    fetch("/api/firma/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: data.first_name, last_name: data.last_name, email: data.email }),
    }).catch(() => {});

    onConfirm({ ...data, role: replacing.role });
  };

  if (showAddForm) {
    return (
      <RecipientForm
        onSave={handleNewSignerSave}
        onCancel={() => setShowAddForm(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 rounded-t-xl">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Change signer</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Select another signer to replace{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {fullName(replacing)}
            </span>.
          </p>

          {/* Search field */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              Choose a new signer
            </label>
            <div className="relative">
              <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus-within:ring-2 focus-within:ring-green-500 focus-within:border-transparent">
                <Search size={14} className="ml-3 text-gray-400 flex-shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(null);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Start typing name or email"
                  className="flex-1 px-2 py-2 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none"
                />
                <ChevronDown size={13} className="mr-2 text-gray-400 flex-shrink-0" />
              </div>

              {/* Dropdown */}
              {showDropdown && (
                <div
                  ref={dropdownRef}
                  className="absolute top-full left-0 right-0 mt-1 z-[80] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-y-auto max-h-72"
                >
                  {filteredContacts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelectContact(c)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: "#6b7280" }}>
                        {(c.first_name[0] ?? "") + (c.last_name?.[0] ?? "")}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {c.first_name} {c.last_name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{c.email}</p>
                      </div>
                    </button>
                  ))}

                  {!loading && filteredContacts.length === 0 && (
                    <div className="px-4 py-3 text-sm text-gray-400">No contacts found.</div>
                  )}

                  {/* Add new signer */}
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      setShowAddForm(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 text-left border-t border-gray-100 dark:border-gray-700 transition-colors"
                  >
                    <UserPlus size={15} />
                    <span className="text-sm font-medium">Add new signer</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleChange}
              disabled={!selected}
              className="flex-1 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              Change
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create / Edit Recipient Form ─────────────────────────────────────────────

interface RecipientFormProps {
  initial?: Partial<ProposalRecipient>;
  onSave: (data: Omit<ProposalRecipient, "id">) => void;
  onCancel: () => void;
}

function RecipientForm({ initial, onSave, onCancel }: RecipientFormProps) {
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !email.trim()) return;
    onSave({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim().toLowerCase(),
      role: initial?.role ?? "signer",
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {initial?.email ? "Edit recipient" : "Create new recipient"}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                First Name
              </label>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                placeholder="First name"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                Last Name
              </label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                placeholder="Last name"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
              Email
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              placeholder="email@example.com"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
            >
              {initial?.email ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProposalRecipientsPanel({ recipients, onChange }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [settingsRecipientId, setSettingsRecipientId] = useState<string | null>(null);
  const [editingRecipient, setEditingRecipient] = useState<ProposalRecipient | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [prefilledEmail, setPrefilledEmail] = useState("");
  const [changingSignerFor, setChangingSignerFor] = useState<ProposalRecipient | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const settingsAnchorRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());

  const getAnchorRef = (id: string) => {
    if (!settingsAnchorRefs.current.has(id)) {
      settingsAnchorRefs.current.set(id, { current: null });
    }
    return settingsAnchorRefs.current.get(id)!;
  };

  const fetchContacts = useCallback(async (q: string) => {
    setLoadingContacts(true);
    try {
      const res = await fetch(`/api/firma/contacts?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts ?? []);
      }
    } catch {
      // silently ignore
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  useEffect(() => {
    if (showDropdown) {
      const timer = setTimeout(() => fetchContacts(searchQuery), 150);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, showDropdown, fetchContacts]);

  // Close main dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !searchRef.current?.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // ── Add from autocomplete ──────────────────────────────────────────────────
  const handleSelectContact = (contact: SavedContact) => {
    if (recipients.some((r) => r.email.toLowerCase() === contact.email.toLowerCase())) {
      setShowDropdown(false);
      setSearchQuery("");
      return;
    }
    onChange([
      ...recipients,
      {
        id: newId(),
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        role: "signer",
      },
    ]);
    setSearchQuery("");
    setShowDropdown(false);
  };

  // ── Create / edit recipient ────────────────────────────────────────────────
  const handleCreateRecipient = (data: Omit<ProposalRecipient, "id">) => {
    if (!editingRecipient) {
      if (recipients.some((r) => r.email.toLowerCase() === data.email.toLowerCase())) {
        onChange(recipients.map((r) =>
          r.email.toLowerCase() === data.email.toLowerCase() ? { ...r, ...data } : r
        ));
      } else {
        onChange([...recipients, { ...data, id: newId() }]);
      }
    } else {
      onChange(recipients.map((r) => r.id === editingRecipient.id ? { ...r, ...data } : r));
    }

    fetch("/api/firma/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: data.first_name, last_name: data.last_name, email: data.email }),
    }).catch(() => {});

    setShowCreateForm(false);
    setEditingRecipient(null);
    setPrefilledEmail("");
  };

  // ── Change signer — replace old with new ──────────────────────────────────
  const handleChangeSignerConfirm = (newData: Omit<ProposalRecipient, "id">) => {
    if (!changingSignerFor) return;
    onChange(
      recipients.map((r) =>
        r.id === changingSignerFor.id ? { ...newData, id: r.id } : r
      )
    );
    setChangingSignerFor(null);
  };

  // ── Other recipient actions ────────────────────────────────────────────────
  const handleRemove = (id: string) => {
    onChange(recipients.filter((r) => r.id !== id));
    setSettingsRecipientId(null);
  };

  const handleEdit = (recipient: ProposalRecipient) => {
    setEditingRecipient(recipient);
    setShowCreateForm(true);
    setSettingsRecipientId(null);
  };

  const filteredContacts = contacts.filter(
    (c) => !recipients.some((r) => r.email.toLowerCase() === c.email.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <Users size={15} className="text-gray-500" />
          Recipients
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          People who will receive and sign this proposal.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {/* Search / Add input */}
        <div className="relative">
          <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-green-500 focus-within:border-transparent">
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Start typing name or email"
              className="flex-1 px-3 py-2 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none"
            />
            <ChevronDown size={14} className="mr-2 text-gray-400 flex-shrink-0" />
          </div>

          {showDropdown && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 right-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto"
            >
              {filteredContacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectContact(c)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: "#6b7280" }}>
                    {(c.first_name[0] ?? "") + (c.last_name?.[0] ?? "")}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {c.first_name} {c.last_name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.email}</p>
                  </div>
                </button>
              ))}
              {!loadingContacts && filteredContacts.length === 0 && searchQuery && (
                <div className="px-4 py-3 text-sm text-gray-400">No contacts found.</div>
              )}
              <button
                onClick={() => {
                  setShowDropdown(false);
                  setPrefilledEmail(searchQuery.includes("@") ? searchQuery : "");
                  setEditingRecipient(null);
                  setShowCreateForm(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 text-left border-t border-gray-100 dark:border-gray-700 transition-colors"
              >
                <UserPlus size={15} />
                <span className="text-sm font-medium">Create new recipient</span>
              </button>
            </div>
          )}
        </div>

        {/* Recipients list */}
        {recipients.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            <Users size={28} className="mx-auto mb-2 opacity-30" />
            <p>No recipients yet.</p>
            <p className="text-xs mt-1">Search above or create a new recipient.</p>
          </div>
        ) : (
          <div className="space-y-1 pt-1">
            {recipients.map((r, idx) => {
              const anchorRef = getAnchorRef(r.id);
              return (
                <div key={r.id} className="relative" ref={(el) => { anchorRef.current = el; }}>
                  <button
                    onClick={() => setSettingsRecipientId((prev) => (prev === r.id ? null : r.id))}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors group"
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ backgroundColor: signerColor(idx) }}
                    >
                      {initials(r)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 truncate">
                        {fullName(r)}
                        <span className={`text-xs font-semibold ${r.role === "signer" ? "text-red-500" : "text-gray-500"}`}>
                          {r.role === "signer" ? "Signer" : "CC"}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 truncate">{r.email}</p>
                    </div>
                    <ChevronDown size={14} className="text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>

                  {settingsRecipientId === r.id && (
                    <RecipientSettingsPopup
                      recipient={r}
                      index={idx}
                      anchorRef={anchorRef}
                      onEdit={() => handleEdit(r)}
                      onChangeSigner={() => {
                        setSettingsRecipientId(null);
                        setChangingSignerFor(r);
                      }}
                      onRemove={() => handleRemove(r.id)}
                      onClose={() => setSettingsRecipientId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-400 text-center">
          {recipients.filter((r) => r.role === "signer").length} signer{recipients.filter((r) => r.role === "signer").length !== 1 ? "s" : ""} •{" "}
          {recipients.filter((r) => r.role === "cc").length} CC
        </p>
      </div>

      {/* Create / Edit Form */}
      {showCreateForm && (
        <RecipientForm
          initial={editingRecipient ?? (prefilledEmail ? { email: prefilledEmail } : undefined)}
          onSave={handleCreateRecipient}
          onCancel={() => {
            setShowCreateForm(false);
            setEditingRecipient(null);
            setPrefilledEmail("");
          }}
        />
      )}

      {/* Change Signer Modal */}
      {changingSignerFor && (
        <ChangeSignerModal
          replacing={changingSignerFor}
          excludeEmails={recipients
            .filter((r) => r.id !== changingSignerFor.id)
            .map((r) => r.email.toLowerCase())}
          onConfirm={handleChangeSignerConfirm}
          onCancel={() => setChangingSignerFor(null)}
        />
      )}
    </div>
  );
}
