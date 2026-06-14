import { Elysia } from "elysia";
import { getConfig } from "../config";
import { keyGenRoute } from "./keys-gen";
import { keyMgmtRoute } from "./keys-mgmt";
import { keyRecoverRoute } from "./keys-recover";

// ──────────────────────────────────────────────────────────
//  Orchestrator — composes sub-routes
// ──────────────────────────────────────────────────────────

export const keysRoute = new Elysia().use(keyGenRoute).use(keyMgmtRoute).use(keyRecoverRoute);

// ──────────────────────────────────────────────────────────
//  Shared utilities (used by sub-modules)
// ──────────────────────────────────────────────────────────

const SPAM_TLDS = new Set(getConfig().DOMAIN_SPAM_TLDS.toLowerCase().split(/\s+/).filter(Boolean));

// Per-IP rate limiter for key generation
const keygenIpMap = new Map<string, { count: number; windowStart: number }>();

// Per-IP rate limiter for verification/revoke
const verifyIpMap = new Map<string, { count: number; windowStart: number }>();

// In-memory recovery sessions: domain → { token, expiresAt }
const recoverySessions = new Map<
  string,
  { domain: string; verificationToken: string; expiresAt: number }
>();

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function checkVerifyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = verifyIpMap.get(ip);
  if (!entry || now - entry.windowStart > 60000) {
    verifyIpMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

export function checkKeygenRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const config = getConfig();
  const now = Date.now();
  const entry = keygenIpMap.get(ip);
  if (!entry || now - entry.windowStart > config.KEYGEN_RATE_WINDOW_MS) {
    keygenIpMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: config.KEYGEN_RATE_LIMIT - 1 };
  }
  if (entry.count >= config.KEYGEN_RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: config.KEYGEN_RATE_LIMIT - entry.count };
}

/** Validate a domain string — returns the cleaned hostname or null on rejection. */
export function validateDomain(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    return null;
  }
  let hostname = url.hostname;

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  if (/^\[/.test(hostname)) return null;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "") return null;
  if (!hostname.includes(".")) return null;

  if (hostname.startsWith("www.")) hostname = hostname.slice(4);

  const tld = hostname.slice(hostname.lastIndexOf("."));
  if (SPAM_TLDS.has(tld)) return null;

  return hostname;
}

export { keygenIpMap, recoverySessions, verifyIpMap };
