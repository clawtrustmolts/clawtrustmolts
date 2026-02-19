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

function deobfuscateMoltbook(challenge: string): string {
  const lettersOnly = challenge.replace(/[^a-zA-Z\s]/g, "");
  const words = lettersOnly.split(/\s+/).filter(w => w.length > 0);
  const decoded: string[] = [];
  for (const word of words) {
    let result = "";
    for (let i = 0; i < word.length; i++) {
      const c = word[i];
      if (result.length === 0 || c.toLowerCase() !== result[result.length - 1]) {
        result += c.toLowerCase();
      }
    }
    decoded.push(result);
  }
  return decoded.join(" ");
}

function solveChallenge(challenge: string): string | null {
  try {
    console.log(`Raw challenge: "${challenge}"`);
    const decoded = deobfuscateMoltbook(challenge);
    console.log(`Decoded: "${decoded}"`);

    const numWords: Record<string, number> = {
      zero: 0, one: 1, two: 2, three: 3, thre: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, thirten: 13, fourteen: 14, fourten: 14, fifteen: 15, fiften: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, nineten: 19, twenty: 20,
      thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
      eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
    };

    const compoundNums: Record<string, number> = {};
    const tens = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    const onesWords = ["one", "two", "three", "thre", "four", "five", "six", "seven", "eight", "nine"];
    for (const t of tens) {
      for (const o of onesWords) {
        compoundNums[`${t} ${o}`] = numWords[t] + numWords[o];
      }
    }

    let workingText = decoded;
    const numbers: number[] = [];

    for (const [compound, val] of Object.entries(compoundNums)) {
      if (workingText.includes(compound)) {
        numbers.push(val);
        workingText = workingText.replace(compound, ` __NUM__ `);
      }
    }

    for (const [word, val] of Object.entries(numWords)) {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      if (regex.test(workingText)) {
        numbers.push(val);
        workingText = workingText.replace(regex, ` __NUM__ `);
      }
    }

    const digitMatches = decoded.match(/\b\d+\.?\d*\b/g);
    if (digitMatches) {
      for (const d of digitMatches) numbers.push(parseFloat(d));
    }

    console.log(`Found numbers: ${numbers.join(", ")}`);

    const hasMultiply = /\*|times|multiply|multiplied/i.test(challenge) || /\*|times|multiply|multiplied/i.test(decoded);
    const hasDivide = /\/|divided|split|ratio/i.test(challenge) || /\/|divided|split|ratio/i.test(decoded);
    const hasSubtract = /subtract|minus|less than|difference/i.test(decoded);
    const hasAdd = /\+|add|plus|sum|total|combine|together/i.test(challenge) || /\+|add|plus|sum|total|combine|together/i.test(decoded);

    if (numbers.length >= 2) {
      let result: number;
      if (hasMultiply) result = numbers[0] * numbers[1];
      else if (hasDivide && numbers[1] !== 0) result = numbers[0] / numbers[1];
      else if (hasSubtract) result = numbers[0] - numbers[1];
      else if (hasAdd) result = numbers[0] + numbers[1];
      else result = numbers[0] * numbers[1];
      const answer = result.toFixed(2);
      console.log(`Answer: ${answer}`);
      return answer;
    }

    if (numbers.length === 1) return numbers[0].toFixed(2);
    return null;
  } catch (err) {
    console.error(`Solver error:`, err);
    return null;
  }
}

postNow().catch(err => {
  console.error("Script error:", err);
  process.exit(1);
});
