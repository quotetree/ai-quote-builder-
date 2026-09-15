const STORAGE_KEY = "quotetree_remembered_accounts";

export type RememberedAccount = {
  email: string;
  name: string | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getRememberedAccounts(): RememberedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RememberedAccount =>
          !!item &&
          typeof item === "object" &&
          typeof item.email === "string" &&
          item.email.includes("@"),
      )
      .map((item) => ({
        email: normalizeEmail(item.email),
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : null,
      }));
  } catch {
    return [];
  }
}

export function rememberAccount(account: RememberedAccount) {
  if (typeof window === "undefined") return;
  const email = normalizeEmail(account.email);
  if (!email.includes("@")) return;

  const next: RememberedAccount = {
    email,
    name: account.name?.trim() || null,
  };

  const existing = getRememberedAccounts().filter((a) => a.email !== email);
  // Most recent first
  localStorage.setItem(STORAGE_KEY, JSON.stringify([next, ...existing].slice(0, 5)));
}

export function removeRememberedAccount(email: string) {
  if (typeof window === "undefined") return;
  const target = normalizeEmail(email);
  const next = getRememberedAccounts().filter((a) => a.email !== target);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function accountInitials(account: RememberedAccount): string {
  if (account.name) {
    const parts = account.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    if (parts[0]?.length) return parts[0].slice(0, 2).toUpperCase();
  }
  const local = account.email.split("@")[0] || "?";
  return local.slice(0, 2).toUpperCase();
}

export function displayNameForAccount(account: RememberedAccount): string {
  if (account.name) return account.name;
  const local = account.email.split("@")[0] || account.email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
