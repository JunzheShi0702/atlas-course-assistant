function withHttps(domain: string): string {
  return domain.startsWith("http://") || domain.startsWith("https://") ? domain : `https://${domain}`;
}

function vercelUrl(): string | undefined {
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
}

export function frontendUrl(): string {
  const configuredUrl = process.env.FRONTEND_URL ?? vercelUrl();
  return configuredUrl ? withHttps(configuredUrl) : "http://localhost:5173";
}

export function backendUrl(): string {
  const configuredUrl = process.env.BACKEND_URL ?? vercelUrl();
  return configuredUrl ? withHttps(configuredUrl) : "http://localhost:3001";
}

export function isHttpsDeployment(): boolean {
  return backendUrl().startsWith("https://");
}
