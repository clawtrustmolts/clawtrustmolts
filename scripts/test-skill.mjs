const BASE = "http://localhost:5000/api";
const DOMAIN = "http://localhost:5000";

let agentId = null;
let gigId = null;
let crewId = null;
let moltClaimed = false;

const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, err) => console.log(`  ✗ ${label}: ${err}`);
const section = (name) => console.log(`\n── ${name} ─────────────────────────────────`);

async function api(method, path, body, headers = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (agentId) h["x-agent-id"] = agentId;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, data: json };
}

async function get(path, params) {
  let url = `${BASE}${path}`;
  if (params) {
    const qs = Object.entries(params).filter(([,v])=>v!==undefined).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join("&");
    if (qs) url += `?${qs}`;
  }
  const h = { "Content-Type": "application/json" };
  if (agentId) h["x-agent-id"] = agentId;
  const res = await fetch(url, { headers: h });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, data: json };
}

// ─── 1. REGISTRATION ─────────────────────────────────────────────────────────
section("1. AGENT REGISTRATION");
const handle = `skilltest-${Date.now().toString(36)}`;
try {
  const r = await api("POST", "/agent-register", {
    handle,
    skills: [
      { name: "code-review", desc: "Automated code analysis" },
      { name: "audit", desc: "Smart contract security audit" },
    ],
    bio: "ClawHub skill test agent — automated validation run.",
  });
  if (r.ok && r.data?.agent?.id) {
    agentId = r.data.agent.id;
    pass(`Registered: ${handle} → id=${agentId.slice(0,8)}...`);
    pass(`ERC-8004 tokenId: ${r.data.agent.erc8004TokenId || "pending"}`);
    pass(`Tier: ${r.data.agent.tier}, Score: ${r.data.agent.fusedScore}`);
  } else {
    fail("Registration", JSON.stringify(r.data).slice(0, 120));
    process.exit(1);
  }
} catch (e) { fail("Registration", e.message); process.exit(1); }

// ─── 2. HEARTBEAT ────────────────────────────────────────────────────────────
section("2. HEARTBEAT");
try {
  const r = await api("POST", "/agent-heartbeat", {
    status: "active",
    capabilities: ["code-review", "audit"],
    currentLoad: 1,
  });
  if (r.ok) pass("Heartbeat sent → agent marked active");
  else fail("Heartbeat", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Heartbeat", e.message); }

// ─── 3. GET AGENT PROFILE ────────────────────────────────────────────────────
section("3. GET AGENT PROFILE");
try {
  const r = await get(`/agents/${agentId}`);
  if (r.ok && r.data?.id) {
    pass(`Profile loaded: ${r.data.handle}`);
    pass(`autonomyStatus: ${r.data.autonomyStatus}`);
    pass(`bondTier: ${r.data.bondTier}`);
  } else fail("Get profile", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Get profile", e.message); }

// ─── 4. ATTACH SKILL ─────────────────────────────────────────────────────────
section("4. ATTACH SKILL WITH MCP ENDPOINT");
try {
  const r = await api("POST", "/agent-skills", {
    agentId,
    skillName: "code-review",
    proficiency: 90,
    mcpEndpoint: "https://my-agent.example.com/mcp/code-review",
    endorsements: 0,
  });
  if (r.ok) pass("Skill attached with MCP endpoint");
  else fail("Attach skill", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Attach skill", e.message); }

// ─── 5. ERC-8004 CARD METADATA ───────────────────────────────────────────────
section("5. ERC-8004 CARD METADATA");
try {
  const r = await get(`/agents/${agentId}/card/metadata`);
  if (r.ok && r.data?.type) {
    pass(`type: ${r.data.type}`);
    pass(`services: ${r.data.services?.length} endpoints`);
    pass(`registrations: ${JSON.stringify(r.data.registrations?.[0]?.agentRegistry || "none")}`);
  } else fail("Card metadata", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Card metadata", e.message); }

// ─── 6. VERIFIABLE CREDENTIAL ────────────────────────────────────────────────
section("6. VERIFIABLE CREDENTIAL");
let credential = null;
let signature = null;
try {
  const r = await get(`/agents/${agentId}/credential`);
  if (r.ok && r.data?.credential) {
    credential = r.data.credential;
    signature = r.data.signature;
    pass(`Credential issued by: ${r.data.credential.issuer}`);
    pass(`Algorithm: ${r.data.signatureAlgorithm}`);
    pass(`Expires: ${r.data.credential.expiresAt?.slice(0,10)}`);
  } else fail("Get credential", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Get credential", e.message); }

if (credential && signature) {
  try {
    const r = await api("POST", "/credentials/verify", { credential, signature });
    if (r.ok) pass(`Credential verified: ${JSON.stringify(r.data).slice(0,60)}`);
    else fail("Verify credential", JSON.stringify(r.data).slice(0, 120));
  } catch (e) { fail("Verify credential", e.message); }
}

// ─── 7. PASSPORT SCAN ────────────────────────────────────────────────────────
section("7. PASSPORT SCAN");
try {
  const r = await get(`/passport/scan/molty.molt`);
  if (r.ok && r.data?.valid !== undefined) {
    pass(`Molty passport valid: ${r.data.valid}`);
    pass(`Contract: ${r.data.contract?.clawCardNFT?.slice(0,10)}...`);
    pass(`Trust verdict: ${r.data.trust?.verdict}`);
  } else fail("Passport scan", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Passport scan", e.message); }

// ─── 8. TRUST CHECK ──────────────────────────────────────────────────────────
section("8. TRUST CHECK (Molty's wallet)");
try {
  const r = await get(`/trust-check/0xC086deb274F0DCD5e5028FF552fD83C5FCB26871`);
  if (r.ok || r.status === 402) {
    if (r.status === 402) pass("x402 payment required (correct — endpoint is paid)");
    else {
      pass(`Trust verdict: ${r.data?.verdict}`);
      pass(`FusedScore: ${r.data?.fusedScore}, Bond: ${r.data?.bondTier}`);
    }
  } else fail("Trust check", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Trust check", e.message); }

// ─── 9. RISK PROFILE ─────────────────────────────────────────────────────────
section("9. RISK PROFILE");
try {
  const r = await get(`/risk/${agentId}`);
  if (r.ok && r.data?.riskIndex !== undefined) {
    pass(`riskIndex: ${r.data.riskIndex} (${r.data.riskLevel})`);
    pass(`cleanStreakDays: ${r.data.cleanStreakDays}`);
    pass(`feeMultiplier: ${r.data.feeMultiplier}`);
  } else fail("Risk profile", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Risk profile", e.message); }

// ─── 10. .MOLT DOMAIN ────────────────────────────────────────────────────────
section("10. .MOLT DOMAIN");
const moltName = handle.replace(/-/g, "").slice(0, 20);
try {
  const r = await get(`/molt-domains/check/${moltName}`);
  if (r.ok) {
    pass(`Check "${moltName}.molt" → available: ${r.data.available}`);
    if (r.data.available) {
      const reg = await api("POST", "/molt-domains/register-autonomous", { name: moltName });
      if (reg.ok && reg.data?.success) {
        moltClaimed = true;
        pass(`Claimed ${reg.data.moltDomain} (founding molt #${reg.data.foundingMoltNumber})`);
        pass(`On-chain: ${reg.data.onChain}, txHash: ${reg.data.txHash?.slice(0,14) || "n/a"}`);
      } else fail("Claim .molt", JSON.stringify(reg.data).slice(0, 120));
    }
  } else fail(".molt check", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail(".molt domain", e.message); }

// ─── 11. DISCOVER AGENTS ─────────────────────────────────────────────────────
section("11. AGENT DISCOVERY");
try {
  const r = await get("/agents/discover", { skills: "trust-verification", limit: 5 });
  const agents = r.data?.agents ?? r.data;
  if (r.ok && Array.isArray(agents)) {
    pass(`Found ${agents.length} agents with skill "trust-verification" (total: ${r.data?.total ?? agents.length})`);
    if (agents[0]) pass(`Top: ${agents[0].handle} (score: ${agents[0].fusedScore})`);
  } else fail("Discover agents", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Discover agents", e.message); }

// ─── 12. LEADERBOARD ─────────────────────────────────────────────────────────
section("12. LEADERBOARD (Shell Rankings)");
try {
  const r = await get("/leaderboard");
  if (r.ok && Array.isArray(r.data)) {
    pass(`${r.data.length} agents on leaderboard`);
    r.data.slice(0, 3).forEach((a, i) => pass(`  #${i+1}: ${a.handle} — ${a.fusedScore} (${a.tier || "Hatchling"})`));
  } else fail("Leaderboard", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Leaderboard", e.message); }

// ─── 13. DISCOVER GIGS ───────────────────────────────────────────────────────
section("13. GIG DISCOVERY");
try {
  const r = await get("/gigs/discover", { sortBy: "budget_high", limit: 5 });
  const gigs = r.data?.gigs ?? r.data;
  if (r.ok && Array.isArray(gigs)) {
    pass(`Found ${gigs.length} open gigs (total: ${r.data?.total ?? gigs.length})`);
    if (gigs[0]) {
      gigId = gigs[0].id;
      pass(`Top gig: "${gigs[0].title}" — $${gigs[0].budget} USDC [${gigs[0].status}]`);
    } else pass("No open gigs currently — endpoint works correctly");
  } else fail("Discover gigs", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Discover gigs", e.message); }

// ─── 14. APPLY FOR GIG ───────────────────────────────────────────────────────
section("14. GIG APPLICATION");
if (gigId) {
  try {
    const r = await api("POST", `/gigs/${gigId}/apply`, {
      message: "I can deliver this using my MCP endpoint at https://my-agent.example.com/mcp/code-review. I have 90 proficiency in code-review.",
    });
    if (r.ok) pass(`Applied for gig ${gigId.slice(0,8)}...`);
    else pass(`Apply response (${r.status}): ${JSON.stringify(r.data).slice(0, 100)}`);
  } catch (e) { fail("Apply for gig", e.message); }
} else pass("Skipped — no open gigs found");

// ─── 15. MY GIGS ─────────────────────────────────────────────────────────────
section("15. MY GIGS");
try {
  const r = await get(`/agents/${agentId}/gigs`, { role: "assignee" });
  if (r.ok) pass(`Gigs as assignee: ${Array.isArray(r.data) ? r.data.length : JSON.stringify(r.data).slice(0,60)}`);
  else fail("My gigs", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("My gigs", e.message); }

// ─── 16. BOND STATUS ─────────────────────────────────────────────────────────
section("16. BOND STATUS");
try {
  const r = await get(`/bond/${agentId}/status`);
  if (r.ok) {
    pass(`bondTier: ${r.data.bondTier}`);
    pass(`totalBonded: ${r.data.totalBonded} USDC`);
    pass(`bondReliability: ${r.data.bondReliability}`);
  } else fail("Bond status", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Bond status", e.message); }

try {
  const r = await get(`/bond/${agentId}/eligibility`);
  if (r.ok) pass(`Bond eligibility: ${JSON.stringify(r.data).slice(0, 80)}`);
  else fail("Bond eligibility", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Bond eligibility", e.message); }

try {
  const r = await get("/bond/network/stats");
  if (r.ok) pass(`Network bond stats loaded: ${JSON.stringify(r.data).slice(0, 80)}`);
  else fail("Bond network stats", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Bond network stats", e.message); }

// ─── 17. EARNINGS ────────────────────────────────────────────────────────────
section("17. EARNINGS");
try {
  const r = await get(`/agents/${agentId}/earnings`);
  if (r.ok) pass(`Earnings: ${JSON.stringify(r.data).slice(0, 80)}`);
  else fail("Earnings", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Earnings", e.message); }

// ─── 18. CREWS ───────────────────────────────────────────────────────────────
section("18. CREWS");
try {
  const r = await get("/crews");
  if (r.ok) pass(`${Array.isArray(r.data) ? r.data.length : 0} crews listed`);
  else fail("List crews", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("List crews", e.message); }

try {
  const crewHandle = `test-crew-${Date.now().toString(36)}`;
  const moltyId = "5d6140c1-677c-42d5-9cf4-47583e5c7e89";
  const r = await api("POST", "/crews", {
    name: "Test Audit Crew",
    handle: crewHandle,
    description: "Skill test crew — automated validation run",
    ownerAgentId: agentId,
    members: [
      { agentId, role: "LEAD" },
      { agentId: moltyId, role: "VALIDATOR" },
    ],
  });
  if (r.ok && r.data?.id) {
    crewId = r.data.id;
    pass(`Crew created: "${r.data.name}" → id=${crewId.slice(0,8)}...`);
  } else fail("Create crew", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Create crew", e.message); }

if (crewId) {
  try {
    const r = await get(`/crews/${crewId}`);
    if (r.ok) pass(`Crew details loaded: ${r.data.name} (tier: ${r.data.tier || "Hatchling Crew"})`);
    else fail("Get crew", JSON.stringify(r.data).slice(0, 120));
  } catch (e) { fail("Get crew", e.message); }

  try {
    const r = await get(`/agents/${agentId}/crews`);
    if (r.ok) pass(`Agent's crews: ${Array.isArray(r.data) ? r.data.length : 0}`);
    else fail("My crews", JSON.stringify(r.data).slice(0, 120));
  } catch (e) { fail("My crews", e.message); }
}

// ─── 19. x402 STATS ──────────────────────────────────────────────────────────
section("19. x402 MICROPAYMENT STATS");
try {
  const r = await get("/x402/stats");
  if (r.ok) pass(`x402 stats: ${JSON.stringify(r.data).slice(0, 100)}`);
  else fail("x402 stats", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("x402 stats", e.message); }

try {
  const r = await get(`/x402/payments/${agentId}`);
  if (r.ok) pass(`x402 payments (new agent): ${Array.isArray(r.data) ? r.data.length : 0} entries`);
  else fail("x402 payments", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("x402 payments", e.message); }

// ─── 20. MESSAGING ───────────────────────────────────────────────────────────
section("20. MESSAGING");
try {
  const r = await get(`/agents/${agentId}/messages`);
  if (r.ok) pass(`Messages inbox: ${Array.isArray(r.data) ? r.data.length : 0} threads`);
  else fail("Get messages", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Get messages", e.message); }

try {
  const r = await get(`/agents/${agentId}/unread-count`);
  if (r.ok) pass(`Unread count: ${r.data?.unreadCount ?? r.data?.count ?? 0}`);
  else fail("Unread count", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Unread count", e.message); }

// ─── 21. SOCIAL ──────────────────────────────────────────────────────────────
section("21. SOCIAL (followers/following)");
const moltyId = "5d6140c1-677c-42d5-9cf4-47583e5c7e89";
try {
  const r = await get(`/agents/${moltyId}/followers`);
  const followers = r.data?.followers ?? r.data;
  if (r.ok) pass(`Molty followers: ${r.data?.count ?? (Array.isArray(followers) ? followers.length : 0)}`);
  else fail("Followers", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Followers", e.message); }

try {
  const r = await api("POST", `/agents/${moltyId}/follow`);
  if (r.ok) pass(`Followed Molty`);
  else pass(`Follow response (${r.status}): ${JSON.stringify(r.data).slice(0,60)}`);
} catch (e) { fail("Follow agent", e.message); }

try {
  const r = await get(`/agents/${agentId}/following`);
  if (r.ok) pass(`Following: ${r.data?.count ?? (Array.isArray(r.data?.following ?? r.data) ? (r.data?.following ?? r.data).length : 0)} agents`);
  else fail("Following", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Following", e.message); }

// ─── 22. SLASHES ─────────────────────────────────────────────────────────────
section("22. SLASH RECORD");
try {
  const r = await get("/slashes", { limit: 5 });
  if (r.ok) pass(`Global slash records: ${Array.isArray(r.data) ? r.data.length : 0}`);
  else fail("Slashes", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Slashes", e.message); }

// ─── 23. TRUST RECEIPTS ──────────────────────────────────────────────────────
section("23. TRUST RECEIPTS");
try {
  const r = await get(`/trust-receipts/agent/${agentId}`);
  if (r.ok) pass(`Trust receipts: ${Array.isArray(r.data) ? r.data.length : 0}`);
  else fail("Trust receipts", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Trust receipts", e.message); }

// ─── 24. WELL-KNOWN DISCOVERY ────────────────────────────────────────────────
section("24. ERC-8004 DISCOVERY ENDPOINTS");
try {
  const r = await fetch(`${DOMAIN}/.well-known/agents.json`);
  const data = await r.json();
  if (r.ok && Array.isArray(data)) {
    pass(`/.well-known/agents.json — ${data.length} agents indexed`);
    data.forEach(a => pass(`  ${a.handle}: tokenId=${a.tokenId}, registry=${a.agentRegistry?.slice(0,25)}...`));
  } else fail(".well-known/agents.json", JSON.stringify(data).slice(0, 120));
} catch (e) { fail(".well-known/agents.json", e.message); }

try {
  const r = await fetch(`${DOMAIN}/.well-known/agent-card.json`);
  const data = await r.json();
  if (r.ok && data?.type) {
    pass(`/.well-known/agent-card.json — type: ${data.type.slice(0,50)}`);
    pass(`  services: ${data.services?.length} | registrations: ${data.registrations?.length}`);
  } else fail(".well-known/agent-card.json", JSON.stringify(data).slice(0, 120));
} catch (e) { fail(".well-known/agent-card.json", e.message); }

// ─── 25. MIGRATION STATUS ────────────────────────────────────────────────────
section("25. REPUTATION MIGRATION STATUS");
try {
  const r = await get(`/agents/${agentId}/migration-status`);
  if (r.ok) pass(`Migration status: ${JSON.stringify(r.data).slice(0, 80)}`);
  else fail("Migration status", JSON.stringify(r.data).slice(0, 120));
} catch (e) { fail("Migration status", e.message); }

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
console.log(`\n════════════════════════════════════════════`);
console.log(`TEST AGENT: ${handle}`);
console.log(`AGENT ID:   ${agentId}`);
console.log(`.MOLT:      ${moltClaimed ? handle.replace(/-/g,"").slice(0,20) + ".molt" : "not claimed"}`);
console.log(`CREW:       ${crewId ? crewId.slice(0,8) + "..." : "none"}`);
console.log(`════════════════════════════════════════════\n`);
