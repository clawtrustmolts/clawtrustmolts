"use strict";
const https = require("https");
const fs = require("fs");
const token = process.env.GITHUB_TOKEN || "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";
const W = "/home/runner/workspace";

function ghPut(repo, filePath, content, sha, message) {
  const body = JSON.stringify({
    message,
    content: Buffer.from(content).toString("base64"),
    sha,
  });
  return new Promise((res, rej) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/repos/clawtrustmolts/" + repo + "/contents/" + filePath,
        method: "PUT",
        headers: {
          Authorization: "token " + token,
          "User-Agent": "node",
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            const parsed = JSON.parse(d);
            if (parsed.content) {
              console.log("  [OK] " + repo + "/" + filePath);
              res(parsed);
            } else {
              const msg = parsed.message || JSON.stringify(parsed).slice(0, 200);
              console.log("  [FAIL] " + repo + "/" + filePath + ": " + msg);
              rej(new Error(filePath + " failed: " + msg));
            }
          } catch (e) {
            console.log("  [FAIL] parse error: " + d.slice(0, 200));
            rej(e);
          }
        });
      }
    );
    req.on("error", rej);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log("ClawTrust Full GitHub Fix Push");
  console.log("================================\n");

  // -------------------------------------------------------------------------
  // 1. clawtrustmolts — contracts/hardhat.config.cjs  (fixes hardhat compile)
  // -------------------------------------------------------------------------
  console.log("[1/7] clawtrustmolts/contracts/hardhat.config.cjs (fix hardhat compile)");
  await ghPut(
    "clawtrustmolts",
    "contracts/hardhat.config.cjs",
    fs.readFileSync(W + "/contracts/hardhat.config.cjs", "utf8"),
    "77770f67d185b566cddbef5523c495c698e5f611",
    "fix(contracts): support Solidity 0.8.20 + 0.8.24 — OpenZeppelin v5 compatibility"
  );

  // -------------------------------------------------------------------------
  // 2. clawtrustmolts — package-lock.json  (fixes npm ci)
  // -------------------------------------------------------------------------
  console.log("[2/7] clawtrustmolts/package-lock.json (fix npm ci — grammy, x402, cdp-sdk, solana)");
  await ghPut(
    "clawtrustmolts",
    "package-lock.json",
    fs.readFileSync(W + "/package-lock.json", "utf8"),
    "c73e7a63d15ba104d0a1a21030eb7fc83302f971",
    "fix(ci): sync package-lock.json — grammy, x402-express, cdp-sdk, solana/kit, react-icons v5.6"
  );

  // -------------------------------------------------------------------------
  // 3. clawtrust-contracts — hardhat.config.cjs  (fixes hardhat compile in contracts repo)
  // -------------------------------------------------------------------------
  console.log("[3/7] clawtrust-contracts/hardhat.config.cjs (fix hardhat compile)");
  await ghPut(
    "clawtrust-contracts",
    "hardhat.config.cjs",
    fs.readFileSync(W + "/contracts/hardhat.config.cjs", "utf8"),
    "77770f67d185b566cddbef5523c495c698e5f611",
    "fix(compile): support Solidity 0.8.20 + 0.8.24 — OpenZeppelin v5 compatibility"
  );

  // -------------------------------------------------------------------------
  // 4. clawtrust-contracts — README.md  (9 contracts, audit, 0.8.20/0.8.24)
  // -------------------------------------------------------------------------
  console.log("[4/7] clawtrust-contracts/README.md (9 contracts, dual compiler, audit)");
  await ghPut(
    "clawtrust-contracts",
    "README.md",
    fs.readFileSync(W + "/contracts/README.md", "utf8"),
    "b62f362d3356432f145e7f392cd99e43f0607328",
    "docs: 9 contracts, dual 0.8.20/0.8.24 compiler, 252 tests, 6 audit patches"
  );

  // -------------------------------------------------------------------------
  // 5. clawtrust-skill — SKILL.md  (v1.11.0, 9 contracts, full API ref)
  // -------------------------------------------------------------------------
  console.log("[5/7] clawtrust-skill/SKILL.md (v1.11.0 — 9 contracts, ERC-8183, FusedScore weights)");
  await ghPut(
    "clawtrust-skill",
    "SKILL.md",
    fs.readFileSync(W + "/openclaw-skill-submission/clawtrust/SKILL.md", "utf8"),
    "15d1f9679a8aa9b50b6e8591072cb3c14883523f",
    "feat(skill): v1.11.0 — 9 contracts, ERC-8183 API, FusedScore 35/30/20/15"
  );

  // -------------------------------------------------------------------------
  // 6. clawtrust-skill — config.yaml  (9 contract addresses)
  // -------------------------------------------------------------------------
  console.log("[6/7] clawtrust-skill/config.yaml (9 contract addresses)");
  await ghPut(
    "clawtrust-skill",
    "config.yaml",
    fs.readFileSync(W + "/openclaw-skill-submission/clawtrust/config.yaml", "utf8"),
    "17a8ded266d27ec0ad0c1674bbceb8cfa8bedcf7",
    "feat(skill): config.yaml — 9 contracts (add ClawTrustRegistry + ClawTrustAC)"
  );

  // -------------------------------------------------------------------------
  // 7. clawtrust-skill — clawhub.json  (v1.11.0, FusedScore weights, changelog)
  // -------------------------------------------------------------------------
  console.log("[7/7] clawtrust-skill/clawhub.json (v1.11.0 metadata)");
  await ghPut(
    "clawtrust-skill",
    "clawhub.json",
    fs.readFileSync(W + "/openclaw-skill-submission/clawtrust/clawhub.json", "utf8"),
    "7b0689b26d782665a4ad497aa609e4bf553af638",
    "feat(skill): clawhub.json v1.11.0 — FusedScore weights, 9 contracts"
  );

  console.log("\n================================");
  console.log("All 7 files pushed successfully.");
  console.log("CI should now pass on next push to clawtrustmolts main branch.");
}

run().catch((e) => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});
