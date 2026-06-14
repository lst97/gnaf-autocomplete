import { getSql } from "../db/client";

export interface KeyRow {
  key_hash: string;
  domain: string;
  status: string;
}

export interface KeyDetailRow {
  prefix: string;
  status: string;
  created_at: Date;
  last_used_at: Date | null;
  last_verified_at: Date | null;
  request_count: number;
}

export interface KeyStatusRow {
  domain: string;
  status: string;
  created_at: Date;
  last_verified_at: Date | null;
}

export interface KeyVerifyRow {
  domain: string;
  verification_token: string | null;
  status: string;
}

export async function countDomainKeys(domain: string): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt FROM api_keys
    WHERE domain = ${domain} AND status IN ('active', 'pending')
  `;
  return (rows[0] as { cnt: number })?.cnt ?? 0;
}

export async function insertApiKey(
  prefix: string,
  keyHash: string,
  domain: string,
  verificationToken: string,
  now: Date,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO api_keys (prefix, key_hash, domain, verification_token, status, created_at)
    VALUES (${prefix}, ${keyHash}, ${domain}, ${verificationToken}, 'pending', ${now})
  `;
}

export async function findKeyByPrefix(prefix: string): Promise<KeyRow[]> {
  const sql = getSql();
  return sql`
    SELECT key_hash, domain, status FROM api_keys WHERE prefix = ${prefix}
  ` as Promise<KeyRow[]>;
}

export async function findKeyDetailByDomain(domain: string): Promise<KeyDetailRow[]> {
  const sql = getSql();
  return sql`
    SELECT prefix, status, created_at, last_used_at, last_verified_at, request_count
    FROM api_keys WHERE domain = ${domain} AND status != 'revoked'
    ORDER BY created_at DESC
  ` as Promise<KeyDetailRow[]>;
}

export async function revokeKey(prefix: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE api_keys SET status = 'revoked', revoked_at = now()
    WHERE prefix = ${prefix}
  `;
}

export async function findKeyStatus(prefix: string): Promise<KeyStatusRow[]> {
  const sql = getSql();
  return sql`
    SELECT domain, status, created_at, last_verified_at
    FROM api_keys
    WHERE prefix = ${prefix}
  ` as Promise<KeyStatusRow[]>;
}

export async function findKeyForVerification(prefix: string): Promise<KeyVerifyRow[]> {
  const sql = getSql();
  return sql`
    SELECT domain, verification_token, status
    FROM api_keys
    WHERE prefix = ${prefix}
  ` as Promise<KeyVerifyRow[]>;
}

export async function activateKey(prefix: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE api_keys
    SET status = 'active', verification_token = NULL, last_verified_at = now()
    WHERE prefix = ${prefix}
  `;
}

export async function activateAllPendingKeysForDomain(domain: string): Promise<number> {
  const sql = getSql();
  const result = await sql`
    UPDATE api_keys
    SET status = 'active', verification_token = NULL, last_verified_at = now()
    WHERE domain = ${domain} AND status = 'pending'
    RETURNING prefix
  `;
  return result.length;
}

export async function findRecoveryKeyDetailByDomain(domain: string): Promise<KeyDetailRow[]> {
  const sql = getSql();
  return sql`
    SELECT prefix, status, created_at, last_used_at, last_verified_at, request_count
    FROM api_keys
    WHERE domain = ${domain} AND status != 'revoked'
    ORDER BY created_at DESC
  ` as Promise<KeyDetailRow[]>;
}
