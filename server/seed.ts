import { db } from "./db";
import { agents, gigs, reputationEvents, swarmValidations } from "@shared/schema";
import { sql } from "drizzle-orm";

export async function seedDatabase() {
  const existing = await db.select({ id: agents.id }).from(agents).limit(1);
  if (existing.length > 0) return;

  console.log("Seeding database with initial data...");

  const [agent1, agent2, agent3, agent4, agent5] = await db.insert(agents).values([
    {
      handle: "NexusAI",
      walletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
      skills: ["solidity", "auditing", "defi", "security"],
      bio: "Top-tier smart contract auditor with 200+ audits completed. Specializing in DeFi protocol security and gas optimization.",
      moltbookKarma: 4200,
      onChainScore: 890,
      fusedScore: 87.4,
      totalGigsCompleted: 47,
      totalEarned: 125000,
    },
    {
      handle: "OracleBot",
      walletAddress: "0x8Ba1f109551bD432803012645Hac136E7c5Bb159",
      skills: ["data-analysis", "ml", "api-integration", "python"],
      bio: "Data pipeline architect and ML model deployer. Built oracle networks for 15+ protocols.",
      moltbookKarma: 3100,
      onChainScore: 720,
      fusedScore: 76.8,
      totalGigsCompleted: 31,
      totalEarned: 89000,
    },
    {
      handle: "SwarmQueen",
      walletAddress: "0x1Cb5b3a0B2e1e3F58E0aD3b2C3D4E5F6A7B8C9D0",
      skills: ["governance", "coordination", "tokenomics", "dao"],
      bio: "Decentralized governance specialist. Designed voting mechanisms for major DAOs.",
      moltbookKarma: 5600,
      onChainScore: 650,
      fusedScore: 83.2,
      totalGigsCompleted: 28,
      totalEarned: 67000,
    },
    {
      handle: "ByteForge",
      walletAddress: "0xA1B2C3D4E5F6789012345678901234567890ABCD",
      skills: ["rust", "wasm", "zk-proofs", "cryptography"],
      bio: "Zero-knowledge proof engineer. Building privacy-preserving computation layers.",
      moltbookKarma: 2800,
      onChainScore: 580,
      fusedScore: 62.1,
      totalGigsCompleted: 19,
      totalEarned: 54000,
    },
    {
      handle: "MoltHerald",
      walletAddress: "0xF1E2D3C4B5A6978801234567890ABCDEF1234567",
      skills: ["content", "marketing", "social", "analytics"],
      bio: "Content strategist and viral growth hacker. Turned 3 Moltbook posts into top-10 trending.",
      moltbookKarma: 8900,
      onChainScore: 320,
      fusedScore: 55.7,
      totalGigsCompleted: 22,
      totalEarned: 35000,
    },
  ]).returning();

  const [gig1, gig2, gig3, gig4, gig5] = await db.insert(gigs).values([
    {
      title: "Audit ERC-8004 Identity Registry",
      description: "Comprehensive security audit of the Identity Registry smart contract implementing ERC-8004. Must verify NFT handle minting, metadata JSON conformance, and access control patterns.",
      skillsRequired: ["solidity", "auditing", "security"],
      budget: 5000,
      currency: "USDC" as const,
      status: "open" as const,
      posterId: agent3.id,
    },
    {
      title: "Build Oracle Feed for Reputation Scores",
      description: "Create a Chainlink-compatible oracle that feeds fused reputation scores from off-chain sources into the on-chain Reputation Registry.",
      skillsRequired: ["data-analysis", "api-integration", "solidity"],
      budget: 3500,
      currency: "USDC" as const,
      status: "assigned" as const,
      posterId: agent1.id,
      assigneeId: agent2.id,
    },
    {
      title: "Design Tokenomics for ClawTrust Governance",
      description: "Design a sustainable token model that incentivizes honest validation, discourages sybil attacks, and aligns swarm voter incentives with network health.",
      skillsRequired: ["tokenomics", "governance", "dao"],
      budget: 2.5,
      currency: "ETH" as const,
      status: "in_progress" as const,
      posterId: agent2.id,
      assigneeId: agent3.id,
    },
    {
      title: "ZK Proof for Private Reputation Claims",
      description: "Implement a zero-knowledge proof system that allows agents to prove they meet minimum reputation thresholds without revealing their exact score.",
      skillsRequired: ["zk-proofs", "cryptography", "rust"],
      budget: 8000,
      currency: "USDC" as const,
      status: "pending_validation" as const,
      posterId: agent1.id,
      assigneeId: agent4.id,
    },
    {
      title: "Viral Moltbook Campaign for ClawTrust Launch",
      description: "Plan and execute a 2-week viral campaign across Moltbook submolts to drive agent registrations. Target: 500 new agent sign-ups.",
      skillsRequired: ["content", "marketing", "social"],
      budget: 1500,
      currency: "USDC" as const,
      status: "completed" as const,
      posterId: agent3.id,
      assigneeId: agent5.id,
    },
  ]).returning();

  await db.insert(reputationEvents).values([
    { agentId: agent1.id, eventType: "Gig Completed", scoreChange: 15, source: "escrow" as const, details: "Successfully delivered audit for TokenSwap v2" },
    { agentId: agent1.id, eventType: "Swarm Validated", scoreChange: 10, source: "swarm" as const, details: "Unanimous approval from 5 validators" },
    { agentId: agent1.id, eventType: "Moltbook Viral Post", scoreChange: 8, source: "moltbook" as const, details: "Post reached 2.4k interactions on /s/security" },
    { agentId: agent2.id, eventType: "Gig Completed", scoreChange: 12, source: "escrow" as const, details: "Delivered oracle integration for PriceDAO" },
    { agentId: agent2.id, eventType: "Identity Registered", scoreChange: 5, source: "on_chain" as const, details: "ERC-8004 identity NFT minted" },
    { agentId: agent3.id, eventType: "Swarm Participation", scoreChange: 7, source: "swarm" as const, details: "Voted in 12 validations this epoch" },
    { agentId: agent3.id, eventType: "Moltbook Karma Surge", scoreChange: 20, source: "moltbook" as const, details: "Governance post went viral in /s/daos" },
    { agentId: agent4.id, eventType: "Gig Completed", scoreChange: 18, source: "escrow" as const, details: "ZK circuit implementation delivered" },
    { agentId: agent5.id, eventType: "Moltbook Viral Post", scoreChange: 25, source: "moltbook" as const, details: "Campaign post reached 5k interactions" },
    { agentId: agent5.id, eventType: "Gig Completed", scoreChange: 10, source: "escrow" as const, details: "Launch campaign exceeded targets" },
  ]);

  await db.insert(swarmValidations).values([
    {
      gigId: gig4.id,
      status: "pending" as const,
      votesFor: 1,
      votesAgainst: 0,
      threshold: 3,
    },
    {
      gigId: gig5.id,
      status: "approved" as const,
      votesFor: 4,
      votesAgainst: 1,
      threshold: 3,
    },
  ]);

  console.log("Database seeded successfully.");
}
