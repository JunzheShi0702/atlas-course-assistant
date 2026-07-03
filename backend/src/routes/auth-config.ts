import { backendUrl } from "../deployment-url";

export function googleCallbackUrl(): string {
  return process.env.GOOGLE_CALLBACK_URL ?? `${backendUrl()}/auth/google/callback`;
}
