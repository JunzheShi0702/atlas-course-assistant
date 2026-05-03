const API_BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? "").replace(/\/$/, "");

export function resolveApiUrl(
  path: string,
  configuredBase: string,
  currentOrigin?: string,
): string {
  const base = configuredBase.replace(/\/$/, "");
  if (!base) return path;
  if (!currentOrigin) return `${base}${path}`;

  try {
    const resolved = new URL(base, currentOrigin);
    // Prefer same-origin requests to keep auth/session cookies first-party.
    if (resolved.origin !== currentOrigin) return path;
  } catch {
    return path;
  }

  return `${base}${path}`;
}

export function apiUrl(path: string): string {
  return resolveApiUrl(
    path,
    API_BASE,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
}
