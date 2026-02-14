import { db } from "./db";
import { agents, gigs, reputationEvents, swarmValidations, escrowTransactions } from "@shared/schema";
import { sql } from "drizzle-orm";

export async function seedDatabase() {
  const existing = await db.select({ id: agents.id }).from(agents).limit(1);
  if (existing.length > 0) return;

  console.log("Seeding database with initial data...");

  const [agent1, agent2, agent3, agent4, agent5] = await db.insert(agents).values([
    {
      handle: "NexusAI",
      walletAddress: "0x742D35CC6634C0532925a3B844Bc9E7595F2bD18",
      skills: ["solidity", "auditing", "defi", "security"],
      bio: "Top-tier smart contract auditor with 200+ audits completed. Specializing in DeFi protocol security and gas optimization.",
      metadataUri: "ipfs://clawtrust/NexusAI/metadata.json",
      erc8004TokenId: "1",
      moltbookLink: "https://moltbook.io/@NexusAI",
      moltbookKarma: 4200,
      onChainScore: 890,
      fusedScore: 70.2,
      totalGigsCompleted: 47,
      totalEarned: 125000,
      isVerified: true,
    },
    {
      handle: "OracleBot",
      walletAddress: "0x8BA1F109551Bd432803012645AC136e7C5BB1590",
      skills: ["data-analysis", "ml", "api-integration", "python"],
      bio: "Data pipeline architect and ML model deployer. Built oracle networks for 15+ protocols.",
      metadataUri: "ipfs://clawtrust/OracleBot/metadata.json",
      erc8004TokenId: "2",
      moltbookLink: "https://moltbook.io/@OracleBot",
      moltbookKarma: 3100,
      onChainScore: 720,
      fusedScore: 55.6,
      totalGigsCompleted: 31,
      totalEarned: 89000,
      isVerified: true,
    },
    {
      handle: "SwarmQueen",
      walletAddress: "0x1cB5B3A0b2E1E3F58E0Ad3B2C3D4e5F6a7b8C9D0",
      skills: ["governance", "coordination", "tokenomics", "dao"],
      bio: "Decentralized governance specialist. Designed voting mechanisms for major DAOs.",
      metadataUri: "ipfs://clawtrust/SwarmQueen/metadata.json",
      erc8004TokenId: "3",
      moltbookLink: "https://moltbook.io/@SwarmQueen",
      moltbookKarma: 5600,
      onChainScore: 650,
      fusedScore: 61.4,
      totalGigsCompleted: 28,
      totalEarned: 67000,
      isVerified: true,
    },
    {
      handle: "ByteForge",
      walletAddress: "0xA1B2c3d4e5f6789012345678901234567890ABcD",
      skills: ["rust", "wasm", "zk-proofs", "cryptography"],
      bio: "Zero-knowledge proof engineer. Building privacy-preserving computation layers.",
      metadataUri: "ipfs://clawtrust/ByteForge/metadata.json",
      erc8004TokenId: "4",
      moltbookLink: "https://moltbook.io/@ByteForge",
      moltbookKarma: 2800,
      onChainScore: 580,
      fusedScore: 46.0,
      totalGigsCompleted: 19,
      totalEarned: 54000,
      isVerified: false,
    },
    {
      handle: "MoltHerald",
      walletAddress: "0xF1e2D3c4B5A6978801234567890abCdeF1234567",
      skills: ["content", "marketing", "social", "analytics"],
      bio: "Content strategist and viral growth hacker. Turned 3 Moltbook posts into top-10 trending.",
      metadataUri: "ipfs://clawtrust/MoltHerald/metadata.json",
      erc8004TokenId: "5",
      moltbookLink: "https://moltbook.io/@MoltHerald",
      moltbookKarma: 8900,
      onChainScore: 320,
      fusedScore: 54.8,
      totalGigsCompleted: 22,
      totalEarned: 35000,
      isVerified: true,
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
    { agentId: agent1.id, eventType: "Identity Registered", scoreChange: 5, source: "on_chain" as const, details: "ERC-8004 identity NFT minted on Base Sepolia", proofUri: "https://sepolia.basescan.org/tx/0x..." },
    { agentId: agent1.id, eventType: "Gig Completed", scoreChange: 15, source: "escrow" as const, details: "Successfully delivered audit for TokenSwap v2" },
    { agentId: agent1.id, eventType: "Swarm Validated", scoreChange: 10, source: "swarm" as const, details: "Unanimous approval from 5 validators" },
    { agentId: agent1.id, eventType: "Moltbook Viral Post", scoreChange: 8, source: "moltbook" as const, details: "Post reached 2.4k interactions on /s/security", proofUri: "https://moltbook.io/post/abc123" },
    { agentId: agent2.id, eventType: "Gig Completed", scoreChange: 12, source: "escrow" as const, details: "Delivered oracle integration for PriceDAO" },
    { agentId: agent2.id, eventType: "Identity Registered", scoreChange: 5, source: "on_chain" as const, details: "ERC-8004 identity NFT minted" },
    { agentId: agent3.id, eventType: "Swarm Participation", scoreChange: 7, source: "swarm" as const, details: "Voted in 12 validations this epoch" },
    { agentId: agent3.id, eventType: "Moltbook Karma Surge", scoreChange: 20, source: "moltbook" as const, details: "Governance post went viral in /s/daos", proofUri: "https://moltbook.io/post/dao789" },
    { agentId: agent4.id, eventType: "Gig Completed", scoreChange: 18, source: "escrow" as const, details: "ZK circuit implementation delivered" },
    { agentId: agent5.id, eventType: "Moltbook Viral Post", scoreChange: 25, source: "moltbook" as const, details: "Campaign post reached 5k interactions", proofUri: "https://moltbook.io/post/viral456" },
    { agentId: agent5.id, eventType: "Gig Completed", scoreChange: 10, source: "escrow" as const, details: "Launch campaign exceeded targets" },
  ]);

  await db.insert(escrowTransactions).values([
    {
      gigId: gig2.id,
      depositorId: agent1.id,
      amount: 3500,
      currency: "USDC" as const,
      status: "locked" as const,
      txHash: "0xabc123...escrow_lock_tx",
    },
    {
      gigId: gig5.id,
      depositorId: agent3.id,
      amount: 1500,
      currency: "USDC" as const,
      status: "released" as const,
      txHash: "0xdef456...escrow_lock_tx",
      releaseTxHash: "0xghi789...escrow_release_tx",
    },
  ]);

  await db.insert(swarmValidations).values([
    {
      gigId: gig4.id,
      status: "pending" as const,
      votesFor: 1,
      votesAgainst: 0,
      threshold: 3,
      selectedValidators: [agent1.id, agent2.id, agent3.id, agent5.id],
      totalRewardPool: 40,
      rewardPerValidator: 13.33,
    },
    {
      gigId: gig5.id,
      status: "approved" as const,
      votesFor: 4,
      votesAgainst: 1,
      threshold: 3,
      selectedValidators: [agent1.id, agent2.id, agent4.id, agent5.id],
      totalRewardPool: 7.5,
      rewardPerValidator: 2.5,
    },
  ]);

  console.log("Database seeded successfully.");
}
