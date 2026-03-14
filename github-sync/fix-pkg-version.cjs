"use strict";
const https = require("https");
const token = "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";

function api(path) {
  return new Promise((res, rej) => {
    const req = https.request(
      {
        hostname: "api.github.com", path, method: "GET",
        headers: { Authorization: "token " + token, "User-Agent": "node", Accept: "application/vnd.github.v3+json" },
      },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { res(d); } });
      }
    );
    req.on("error", rej);
    req.end();
  });
}

function ghPut(repo, filePath, content, sha, message) {
  const body = JSON.stringify({ message, content: Buffer.from(content).toString("base64"), sha });
  return new Promise((res, rej) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/repos/clawtrustmolts/" + repo + "/contents/" + filePath,
        method: "PUT",
        headers: {
          Authorization: "token " + token, "User-Agent": "node",
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        },
      },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          const p = JSON.parse(d);
          if (p.content) { console.log("  [OK] " + repo + "/" + filePath); res(p); }
          else { console.log("  [FAIL] " + (p.message || JSON.stringify(p).slice(0, 200))); rej(new Error(p.message)); }
        });
      }
    );
    req.on("error", rej);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("Fixing GitHub package.json @openzeppelin/contracts version...");
  const ghData = await api("/repos/clawtrustmolts/clawtrustmolts/contents/package.json");
  const content = Buffer.from(ghData.content, "base64").toString("utf8");
  const updated = content.replace(
    '"@openzeppelin/contracts": "^5.4.0"',
    '"@openzeppelin/contracts": "^5.0.0"'
  );
  if (content === updated) {
    console.log("Already matches — no update needed.");
    return;
  }
  console.log("Patching ^5.4.0 -> ^5.0.0 to match lock file...");
  await ghPut(
    "clawtrustmolts", "package.json", updated, ghData.sha,
    "fix(ci): align @openzeppelin/contracts ^5.4.0->^5.0.0 to match lock file"
  );
  console.log("Done. CI npm ci should now pass.");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
