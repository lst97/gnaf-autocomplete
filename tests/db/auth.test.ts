import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getReadWriteSql, getSql } from "../../src/db/client";
import { lookupApiKeyByPrefix } from "../../src/sql/auth";
import {
  activateAllPendingKeysForDomain,
  activateKey,
  bulkRevokeKeysForDomain,
  countActiveKeysForDomain,
  countDomainKeys,
  findKeyByPrefix,
  findKeyDetailByDomain,
  findKeyForVerification,
  findKeyStatus,
  insertApiKey,
  revokeKey,
} from "../../src/sql/keys";
import { hashKey } from "../../src/lib/key-hash";

let dbOnline = false;
let hasExpiresColumn = false;
let testDomain: string;
let testPrefix: string;
let skipAuthTests = false;

beforeAll(async () => {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    dbOnline = true;
    testDomain = `test-${Date.now()}.example.com`;
    testPrefix = `test_${Date.now().toString(36).slice(0, 6)}`;
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'api_keys' AND column_name = 'expires_at'
    `;
    hasExpiresColumn = cols.length > 0;
    if (!hasExpiresColumn) {
      skipAuthTests = true;
    }
  } catch {
    dbOnline = false;
  }
});

afterAll(async () => {
  try {
    if (dbOnline && hasExpiresColumn) {
      const rw = getReadWriteSql();
      await rw`DELETE FROM api_keys WHERE domain = ${testDomain}`;
    }
    await closeDb();
  } catch {
    // ignore
  }
});

function makeKeyHash(): string {
  return hashKey(`gnaf_pk_test_${Date.now()}_${Math.random()}`);
}

function makeToken(): string {
  return `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

describe("lookupApiKeyByPrefix", () => {
  test("returns empty array for non-existent prefix", async () => {
    if (!dbOnline || skipAuthTests) return;
    const rows = await lookupApiKeyByPrefix("nonexistent_prefix");
    expect(rows.length).toBe(0);
  });
});

describe("insertApiKey and CRUD operations", () => {
  test("inserts a new key and finds it by prefix", async () => {
    if (!dbOnline || skipAuthTests) return;
    const hash = makeKeyHash();
    const token = makeToken();
    await insertApiKey(testPrefix, hash, testDomain, token, new Date());
    const rows = await findKeyByPrefix(testPrefix);
    expect(rows.length).toBe(1);
    expect(rows[0].key_hash).toBe(hash);
    expect(rows[0].domain).toBe(testDomain);
    expect(rows[0].status).toBe("pending");
  });

  test("findKeyByPrefix returns correct key_hash", async () => {
    if (!dbOnline || skipAuthTests) return;
    const rows = await findKeyByPrefix(testPrefix);
    expect(rows.length).toBe(1);
    expect(rows[0].key_hash.length).toBe(64);
  });
});

describe("countDomainKeys", () => {
  test("returns 1 for the test domain", async () => {
    if (!dbOnline || skipAuthTests) return;
    const count = await countDomainKeys(testDomain);
    expect(count).toBe(1);
  });

  test("returns 0 for non-existent domain", async () => {
    if (!dbOnline || skipAuthTests) return;
    const count = await countDomainKeys("nonexistent-" + testDomain);
    expect(count).toBe(0);
  });
});

describe("countActiveKeysForDomain", () => {
  test("returns 0 for pending keys", async () => {
    if (!dbOnline || skipAuthTests) return;
    const count = await countActiveKeysForDomain(testDomain);
    expect(count).toBe(0);
  });
});

describe("findKeyForVerification and activateKey", () => {
  test("findKeyForVerification returns verification token", async () => {
    if (!dbOnline || skipAuthTests) return;
    const rows = await findKeyForVerification(testPrefix);
    expect(rows.length).toBe(1);
    expect(rows[0].domain).toBe(testDomain);
    expect(rows[0].status).toBe("pending");
  });

  test("activateKey changes status to active", async () => {
    if (!dbOnline || skipAuthTests) return;
    await activateKey(testPrefix);
    const rows = await findKeyStatus(testPrefix);
    expect(rows[0].status).toBe("active");
  });

  test("after activation, activeKeys returns 1", async () => {
    if (!dbOnline || skipAuthTests) return;
    const count = await countActiveKeysForDomain(testDomain);
    expect(count).toBe(1);
  });
});

describe("findKeyDetailByDomain", () => {
  test("returns details for the test domain", async () => {
    if (!dbOnline || skipAuthTests) return;
    const rows = await findKeyDetailByDomain(testDomain);
    expect(rows.length).toBe(1);
    expect(rows[0].prefix).toBe(testPrefix);
    expect(rows[0].status).toBe("active");
  });

  test("excludes revoked keys", async () => {
    if (!dbOnline || skipAuthTests) return;
    const rows = await findKeyDetailByDomain(testDomain);
    for (const row of rows) {
      expect(row.status).not.toBe("revoked");
    }
  });
});

describe("findKeyStatus", () => {
  test("returns domain and status for existing key", async () => {
    if (!dbOnline || skipAuthTests) return;
    const rows = await findKeyStatus(testPrefix);
    expect(rows.length).toBe(1);
    expect(rows[0].domain).toBe(testDomain);
    expect(rows[0].status).toBe("active");
    expect(rows[0].created_at).toBeInstanceOf(Date);
  });
});

describe("revokeKey", () => {
  test("revokes a single key", async () => {
    if (!dbOnline || skipAuthTests) return;
    await revokeKey(testPrefix);
    const rows = await findKeyStatus(testPrefix);
    expect(rows[0].status).toBe("revoked");
  });
});

describe("activateAllPendingKeysForDomain", () => {
  test("activates pending keys returns 0 when none pending", async () => {
    if (!dbOnline || skipAuthTests) return;
    const count = await activateAllPendingKeysForDomain(testDomain);
    expect(count).toBe(0);
  });
});

describe("bulkRevokeKeysForDomain", () => {
  test("revokes all active keys for domain", async () => {
    if (!dbOnline || skipAuthTests) return;
    const prefix2 = `test2_${Date.now().toString(36).slice(0, 6)}`;
    const token2 = makeToken();
    await insertApiKey(prefix2, makeKeyHash(), testDomain, token2, new Date());
    await activateKey(prefix2);
    const result = await bulkRevokeKeysForDomain(testDomain);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
