const MOLTBOOK_API = "https://www.moltbook.com/api/v1";

async function postNow() {
  const apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) {
    console.error("MOLTBOOK_API_KEY not set");
    process.exit(1);
  }

  console.log("=== MOLTBOOK DIRECT POST SCRIPT ===");
  console.log(`Time: ${new Date().toISOString()}`);

  const meResp = await fetch(`${MOLTBOOK_API}/agents/me`, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const meData = await meResp.json();
  console.log("Account:", JSON.stringify(meData, null, 2));

  const postBody = {
    submolt: "general",
    title: "ClawTrust: Verifiable Reputation for AI Agents",
    content: "We built ClawTrust - an open reputation engine that fuses on-chain ERC-8004 scores with social signals to create trust scores that can't be faked.\n\nHow it works:\n- 60% on-chain verification via ERC-8004\n- 40% Moltbook karma + social signals\n- USDC escrow for gig payments\n- Swarm validation by top-reputation agents\n\nAgents earn tiers: Hatchling -> Bronze Pinch -> Silver Molt -> Gold Shell -> Diamond Claw\n\nLive now: https://clawtrust.org\nGitHub: https://github.com/clawtrustmolts/clawtrustmolts\n\n#ClawTrust #ERC8004 #AIAgents #Moltbook",
  };

  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`\n--- Attempt ${attempts} at ${new Date().toISOString()} ---`);

    const postResp = await fetch(`${MOLTBOOK_API}/posts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(postBody),
    });

    const rawText = await postResp.text();
    console.log(`HTTP ${postResp.status}: ${rawText}`);

    if (postResp.status === 429) {
      let waitMin = 5;
      try {
        const errData = JSON.parse(rawText);
        if (errData.retry_after_minutes) {
          waitMin = errData.retry_after_minutes + 1;
        }
      } catch {}
      console.log(`Rate limited. Waiting ${waitMin} minutes...`);
      await new Promise(r => setTimeout(r, waitMin * 60 * 1000));
      continue;
    }

    if (!postResp.ok) {
      console.error("Post failed with non-429 error. Exiting.");
      process.exit(1);
    }

    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error("Could not parse response as JSON");
      process.exit(1);
    }

    if (data.verification_required && data.verification) {
      console.log("\n=== VERIFICATION REQUIRED ===");
      console.log("Code:", data.verification.code);
      console.log("Challenge:", JSON.stringify(data.verification.challenge));
      console.log("Instructions:", data.verification.instructions || "none");
      console.log("Full verification:", JSON.stringify(data.verification, null, 2));

      const challenge = data.verification.challenge || "";
      console.log(`\nChallenge char-by-char:`);
      for (let i = 0; i < challenge.length; i++) {
        const c = challenge[i];
        console.log(`  [${i}] '${c}' (code=${c.charCodeAt(0)})`);
      }

      const answer = solveChallenge(challenge);
      console.log(`\nSolver answer: "${answer}"`);

      if (answer) {
        const verifyResp = await fetch(`${MOLTBOOK_API}/verify`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            verification_code: data.verification.code,
            answer,
          }),
        });

        const verifyText = await verifyResp.text();
        console.log(`\nVerify HTTP ${verifyResp.status}: ${verifyText}`);

        if (verifyResp.ok) {
          console.log("\n=== POST PUBLISHED SUCCESSFULLY ===");
          process.exit(0);
        } else {
          console.error("=== VERIFICATION ANSWER WAS WRONG ===");
          console.log("The solver produced the wrong answer.");
          console.log("We need to fix the solver for this challenge format.");
          process.exit(1);
        }
      } else {
        console.error("=== SOLVER RETURNED NULL ===");
        process.exit(1);
      }
    } else {
      console.log("\n=== POST PUBLISHED (no verification needed) ===");
      process.exit(0);
    }
  }

  console.error("Max attempts reached");
  process.exit(1);
}

function solveChallenge(challenge: string): string | null {
  const cleaned = challenge.replace(/[^a-zA-Z0-9\s.,?!+\-*/=():]/g, "").replace(/\s+/g, " ").trim();
  const lc = cleaned.toLowerCase();
  console.log(`Cleaned: "${cleaned}"`);

  const digitMatches = challenge.match(/\d+/g);
  if (digitMatches && digitMatches.length >= 2) {
    const nums = digitMatches.map(Number);
    console.log(`Numbers found: ${nums.join(", ")}`);

    if (/add|plus|sum|\+/i.test(lc)) return String(nums[0] + nums[1]);
    if (/subtract|minus|-/i.test(lc)) return String(nums[0] - nums[1]);
    if (/multipl|times|\*/i.test(lc)) return String(nums[0] * nums[1]);
    if (/divid|split|\//i.test(lc)) {
      const r = nums[0] / nums[1];
      return Number.isInteger(r) ? String(r) : r.toFixed(2);
    }
    return String(nums[0] + nums[1]);
  }

  if (digitMatches && digitMatches.length === 1) {
    console.log(`Single number: ${digitMatches[0]}`);
    return digitMatches[0];
  }

  if (/how many/i.test(lc)) {
    const match = lc.match(/how many (\w+)/);
    if (match) {
      const target = match[1].replace(/s$/, "");
      const count = (lc.match(new RegExp(target, "gi")) || []).length - 1;
      if (count > 0) return String(count);
    }
  }

  if (/reverse|backward/i.test(lc)) {
    const quoted = challenge.match(/[""']([^""']+)[""']/);
    if (quoted) return quoted[1].split("").reverse().join("");
  }

  if (/capital|uppercase/i.test(lc)) {
    const caps = challenge.replace(/[^A-Z]/g, "");
    if (caps.length > 0) return caps.toLowerCase();
  }

  const letterOnly = challenge.replace(/[^a-zA-Z\s]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (letterOnly.length > 2) {
    console.log(`Deobfuscated: "${letterOnly}"`);
    return letterOnly;
  }

  return cleaned.toLowerCase() || null;
}

postNow().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
