import { createPublicClient, createWalletClient, http, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ESCROW_ADDRESS = "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA";
const DEPLOYER_ADDRESS = "0x66e5046D136E82d17cbeB2FfEa5bd5205D962906";

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error("DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}

const normalizedPk = (pk.trim().startsWith("0x") ? pk.trim() : `0x${pk.trim()}`);

const escrowArtifact = JSON.parse(
  readFileSync(join(__dirname, "../contracts/artifacts/contracts/ClawTrustEscrow.sol/ClawTrustEscrow.json"), "utf-8")
);

const account = privateKeyToAccount(normalizedPk);
console.log("Deployer address:", account.address);

const rpc = process.env.BASE_RPC_URL || "https://sepolia.base.org";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpc),
});

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(rpc),
});

const escrow = getContract({
  address: ESCROW_ADDRESS,
  abi: escrowArtifact.abi,
  client: { public: publicClient, wallet: walletClient },
});

async function main() {
  const currentFacilitator = await escrow.read.x402Facilitator();
  console.log("Current x402Facilitator:", currentFacilitator);

  if (currentFacilitator.toLowerCase() === DEPLOYER_ADDRESS.toLowerCase()) {
    console.log("x402 facilitator already set correctly. Nothing to do.");
    return;
  }

  console.log("Setting x402Facilitator to deployer:", DEPLOYER_ADDRESS);
  const txHash = await escrow.write.setX402Facilitator([DEPLOYER_ADDRESS]);
  console.log("Tx sent:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("Confirmed in block:", receipt.blockNumber.toString());
  console.log("BaseScan:", `https://sepolia.basescan.org/tx/${txHash}`);
  console.log("x402 facilitator set successfully!");
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
