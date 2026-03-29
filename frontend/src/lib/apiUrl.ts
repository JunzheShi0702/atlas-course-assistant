const API_BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? "").replace(/\/$/, "");

function getResolvedApiBase(): string {
  if (!API_BASE) return "";
  if (typeof window === "undefined") return API_BASE;

  try {
    const resolved = new URL(API_BASE, window.location.origin);
    // Prefer same-origin requests to keep auth/session cookies first-party.
    if (resolved.origin !== window.location.origin) return "";
  } catch {
    return "";
  }

  return API_BASE;
}

export function apiUrl(path: string): string {
  const base = getResolvedApiBase();
  return base ? `${base}${path}` : path;
}
