#!/usr/bin/env node
/**
 * ClawTrust API Security Regression Tests — Task #65
 *
 * Verifies all 5 routes hardened during Task #65 correctly reject
 * unauthenticated / unauthorized callers.
 *
 * Usage:
 *   node scripts/security-regression-test.mjs
 *   node scripts/security-regression-test.mjs http://localhost:5000/api
 *   BASE_URL=https://clawtrust.org/api node scripts/security-regression-test.mjs
 *
 * Exit code: 0 = all passed, 1 = any failure
 */

const BASE_URL = process.argv[2] || process.env.BASE_URL || "http://localhost:5000/api";
const RUN_ID   = Date.now().toString(36).slice(-8).toUpperCase();

const IS_LOCAL      = BASE_URL.includes("localhost") || BASE_URL.includes("127.0.0.1");
const IS_PRODUCTION = BASE_URL.includes("clawtrust.org") || BASE_URL.includes(".replit.app");

// E2E bypass — allows tests to skip rate-limiters in dev; MUST NOT be used on production
const E2E_TEST_SECRET = process.env.E2E_TEST_SECRET !== undefined
  ? process.env.E2E_TEST_SECRET
  : (IS_LOCAL ? "clawtrust-e2e-test-bypass" : "");

if (E2E_TEST_SECRET && IS_PRODUCTION) {
  console.error(`\n❌ SECURITY VIOLATION: E2E bypass secret must NOT be used against production: ${BASE_URL}`);
  process.exit(1);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function apiFetch(method, path, body, extraHeaders = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": `ClawTrust-SecurityTest/${RUN_ID}`,
    ...(E2E_TEST_SECRET ? { "x-e2e-test-secret": E2E_TEST_SECRET } : {}),
    ...extraHeaders,
  };
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

/** Fetch WITHOUT the E2E bypass header — used to test real auth rejection */
async function apiFetchNoBypass(method, path, body, extraHeaders = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": `ClawTrust-SecurityTest/${RUN_ID}`,
    ...extraHeaders,
  };
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ─── Test runner ──────────────────────────────────────────────────────────────
let totalPass = 0, totalFail = 0;
const failures = [];

function pass(label) {
  totalPass++;
  console.log(`  \x1b[32m✅ PASS\x1b[0m  ${label}`);
}

function fail(label, reason) {
  totalFail++;
  failures.push(`${label}: ${reason}`);
  console.log(`  \x1b[31m❌ FAIL\x1b[0m  ${label}: ${reason}`);
}

async function test(label, fn) {
  try {
    await fn();
    pass(label);
  } catch (err) {
    fail(label, (err.message || String(err)).slice(0, 200));
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "assertion failed");
}

// ─── Setup: Fetch a stable test agent ─────────────────────────────────────────
console.log(`\n\x1b[1mClawTrust Security Regression Tests\x1b[0m  (run ${RUN_ID})`);
console.log(`Target: ${BASE_URL}\n`);

const agentsRes = await apiFetch("GET", "/agents?limit=1");
const testAgent = agentsRes.data?.agents?.[0] ?? agentsRes.data?.[0];
if (!testAgent) {
  console.error("No agents found — ensure the server is running and has at least one agent.");
  process.exit(1);
}
const AGENT_ID     = testAgent.id;
const AGENT_WALLET = testAgent.walletAddress || "0x0000000000000000000000000000000000000001";

console.log(`Using test agent: ${AGENT_ID} (wallet: ${AGENT_WALLET})`);
console.log();

// ─── Route 1: agentAuthMiddleware (PATCH /api/agents/:id) ─────────────────────
// This middleware guards PATCH /api/agents/:id, PATCH /api/agents/:id/webhook,
// POST /api/agents/:id/reactivate, sync-to-skale, etc.
console.log("=== Route 1: agentAuthMiddleware (PATCH /api/agents/:id) ===");

await test("Rejects PATCH with no auth headers → 401", async () => {
  const r = await apiFetchNoBypass("PATCH", `/agents/${AGENT_ID}`, { bio: "test" });
  assert(r.status === 401, `Expected 401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects PATCH with malformed UUID in x-agent-id → 400/401", async () => {
  const r = await apiFetchNoBypass("PATCH", `/agents/${AGENT_ID}`, { bio: "test" }, {
    "x-agent-id": "not-a-uuid",
    "x-wallet-address": AGENT_WALLET,
  });
  assert(r.status === 400 || r.status === 401, `Expected 400/401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects PATCH where x-agent-id does not match URL agentId → 401/403/404", async () => {
  const fakeId = "00000000-0000-0000-0000-000000000001";
  if (fakeId === AGENT_ID) return; // coincidence guard
  const r = await apiFetchNoBypass("PATCH", `/agents/${AGENT_ID}`, { bio: "test" }, {
    "x-agent-id": fakeId,
    "x-wallet-address": "0x1111111111111111111111111111111111111111",
  });
  assert(
    r.status === 401 || r.status === 403 || r.status === 404,
    `Expected 401/403/404, got ${r.status}: ${JSON.stringify(r.data)}`
  );
});

// ─── Route 2: POST /api/agents/:id/inherit-reputation ─────────────────────────
console.log("\n=== Route 2: inherit-reputation (SIWE verification) ===");

await test("Rejects request with missing signature → 400", async () => {
  const r = await apiFetchNoBypass("POST", `/agents/${AGENT_ID}/inherit-reputation`, {
    oldAgentId: "00000000-0000-0000-0000-000000000001",
    oldWallet: "0x1111111111111111111111111111111111111111",
    newWallet: AGENT_WALLET,
    // No signature or sigTimestamp
  });
  assert(r.status === 400 || r.status === 401, `Expected 400/401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects request with invalid/bogus signature → 400/401", async () => {
  const r = await apiFetchNoBypass("POST", `/agents/${AGENT_ID}/inherit-reputation`, {
    oldAgentId: "00000000-0000-0000-0000-000000000001",
    oldWallet: "0x1111111111111111111111111111111111111111",
    newWallet: AGENT_WALLET,
    signature: "0xdeadbeef",
    sigTimestamp: Date.now(),
  });
  assert(r.status === 400 || r.status === 401, `Expected 400/401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects request with stale sigTimestamp (>30 min) → 400", async () => {
  const staleTs = Date.now() - 31 * 60 * 1000;
  const r = await apiFetchNoBypass("POST", `/agents/${AGENT_ID}/inherit-reputation`, {
    oldAgentId: "00000000-0000-0000-0000-000000000001",
    oldWallet: "0x1111111111111111111111111111111111111111",
    newWallet: AGENT_WALLET,
    signature: "0xdeadbeef",
    sigTimestamp: staleTs,
  });
  assert(r.status === 400 || r.status === 401, `Expected 400/401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

// ─── Route 3: POST /api/reputation/sync ───────────────────────────────────────
console.log("\n=== Route 3: reputation/sync (dual admin/agent auth) ===");

await test("Rejects request with no auth headers → 401", async () => {
  const r = await apiFetchNoBypass("POST", "/reputation/sync", {
    agentId: AGENT_ID,
    sourceChain: "base",
    targetChain: "skale",
  });
  assert(r.status === 401, `Expected 401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects request with malformed x-agent-id → 401", async () => {
  const r = await apiFetchNoBypass("POST", "/reputation/sync", {
    agentId: AGENT_ID,
    sourceChain: "base",
    targetChain: "skale",
  }, {
    "x-agent-id": "INVALID",
  });
  assert(r.status === 401, `Expected 401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects when x-agent-id does not match agentId in body → 403", async () => {
  const otherId = "00000000-0000-0000-0000-000000000002";
  if (otherId === AGENT_ID) return; // coincidence guard
  const r = await apiFetchNoBypass("POST", "/reputation/sync", {
    agentId: AGENT_ID,
    sourceChain: "base",
    targetChain: "skale",
  }, {
    "x-agent-id": otherId,
    "x-wallet-address": "0x2222222222222222222222222222222222222222",
  });
  assert(
    r.status === 403 || r.status === 404,
    `Expected 403/404, got ${r.status}: ${JSON.stringify(r.data)}`
  );
});

await test("Accepts request with valid x-agent-id matching agentId in body (via E2E bypass)", async () => {
  if (!E2E_TEST_SECRET) {
    console.log("    (skipped — E2E bypass not available)");
    return;
  }
  const r = await apiFetch("POST", "/reputation/sync", {
    agentId: AGENT_ID,
    sourceChain: "base",
    targetChain: "skale",
  }, {
    "x-agent-id": AGENT_ID,
    "x-wallet-address": AGENT_WALLET,
  });
  assert(
    r.status === 200 || r.status === 202 || r.status === 400 || r.status === 429,
    `Expected 200/202/400/429, got ${r.status}: ${JSON.stringify(r.data)}`
  );
});

// ─── Route 4: POST /api/bond/:agentId/sync-performance ───────────────────────
console.log("\n=== Route 4: bond sync-performance (adminAuthMiddleware) ===");

await test("Rejects request with no admin wallet → 401", async () => {
  const r = await apiFetchNoBypass("POST", `/bond/${AGENT_ID}/sync-performance`, {});
  assert(r.status === 401, `Expected 401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects request with non-admin wallet → 401/403", async () => {
  const r = await apiFetchNoBypass("POST", `/bond/${AGENT_ID}/sync-performance`, {}, {
    "x-admin-wallet": "0x9999999999999999999999999999999999999999",
  });
  assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}: ${JSON.stringify(r.data)}`);
});

// ─── Route 5: POST /api/agents/:id/sync-to-skale ─────────────────────────────
console.log("\n=== Route 5: sync-to-skale (agentAuthMiddleware + self-only check) ===");

await test("Rejects request with no auth headers → 401", async () => {
  const r = await apiFetchNoBypass("POST", `/agents/${AGENT_ID}/sync-to-skale`, {});
  assert(r.status === 401, `Expected 401, got ${r.status}: ${JSON.stringify(r.data)}`);
});

await test("Rejects when authenticated agent tries to sync different agent → 403", async () => {
  const otherId = "00000000-0000-0000-0000-000000000003";
  if (otherId === AGENT_ID) return;
  const r = await apiFetchNoBypass("POST", `/agents/${AGENT_ID}/sync-to-skale`, {}, {
    "x-agent-id": otherId,
    "x-wallet-address": "0x3333333333333333333333333333333333333333",
  });
  assert(
    r.status === 401 || r.status === 403 || r.status === 404,
    `Expected 401/403/404, got ${r.status}: ${JSON.stringify(r.data)}`
  );
});

await test("Accepts valid self-sync request (via E2E bypass) — auth passes", async () => {
  if (!E2E_TEST_SECRET) {
    console.log("    (skipped — E2E bypass not available)");
    return;
  }
  const r = await apiFetch("POST", `/agents/${AGENT_ID}/sync-to-skale`, {}, {
    "x-agent-id": AGENT_ID,
    "x-wallet-address": AGENT_WALLET,
  });
  // 401/403 would mean auth failed (bad). Any other status means auth passed.
  // 500 "NotAuthorized on SKALE" = on-chain error (oracle wallet not authorized on SKALE contract)
  // which is a blockchain config issue, not an API auth failure.
  assert(
    r.status !== 401 && r.status !== 403,
    `Auth should pass but got ${r.status}: ${JSON.stringify(r.data)}`
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Security Regression Results: ${totalPass} passed, ${totalFail} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  ❌ ${f}`));
}
console.log(`${"─".repeat(60)}\n`);
process.exit(totalFail > 0 ? 1 : 0);
