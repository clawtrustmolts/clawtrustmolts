import fs from "fs";
import path from "path";

const GITHUB_API = "https://api.github.com";
const REPO_OWNER = "clawtrustmolts";
const REPO_NAME = "clawtrust";

interface GitHubFile {
  path: string;
  localPath: string;
}

const PROTOCOL_FILES: GitHubFile[] = [
  { path: "README.md", localPath: "README.md" },
  { path: "CONTRIBUTING.md", localPath: "CONTRIBUTING.md" },
  { path: "skills/clawtrust-integration.md", localPath: "skills/clawtrust-integration.md" },
  { path: "shared/clawtrust-sdk/README_SDK.md", localPath: "shared/clawtrust-sdk/README_SDK.md" },
  { path: "shared/clawtrust-sdk/index.ts", localPath: "shared/clawtrust-sdk/index.ts" },
  { path: "contracts/contracts/ClawTrustEscrow.sol", localPath: "contracts/contracts/ClawTrustEscrow.sol" },
  { path: "contracts/contracts/ERC8004RepAdapter.sol", localPath: "contracts/contracts/ERC8004RepAdapter.sol" },
  { path: "contracts/contracts/SwarmValidator.sol", localPath: "contracts/contracts/SwarmValidator.sol" },
  { path: "contracts/contracts/ClawCardNFT.sol", localPath: "contracts/contracts/ClawCardNFT.sol" },
  { path: "contracts/scripts/deploy.cjs", localPath: "contracts/scripts/deploy.cjs" },
  { path: "contracts/scripts/verify-deployment.cjs", localPath: "contracts/scripts/verify-deployment.cjs" },
  { path: "contracts/hardhat.config.cjs", localPath: "contracts/hardhat.config.cjs" },
  { path: "shared/schema.ts", localPath: "shared/schema.ts" },
];

function getToken(): string {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) throw new Error("GITHUB_PERSONAL_ACCESS_TOKEN not configured");
  return token;
}

async function githubRequest(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }

  return res.json();
}

async function getFileSha(filePath: string): Promise<string | null> {
  try {
    const data = await githubRequest(
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`
    );
    return data.sha || null;
  } catch {
    return null;
  }
}

async function pushFile(
  filePath: string,
  content: string,
  commitMessage: string
): Promise<{ path: string; status: "created" | "updated" | "unchanged" | "error"; message?: string }> {
  try {
    const sha = await getFileSha(filePath);

    const encodedContent = Buffer.from(content).toString("base64");

    if (sha) {
      const existing = await githubRequest(
        `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`
      );
      if (existing.content) {
        const existingContent = Buffer.from(
          existing.content.replace(/\n/g, ""),
          "base64"
        ).toString("utf-8");
        if (existingContent === content) {
          return { path: filePath, status: "unchanged" };
        }
      }
    }

    const body: any = {
      message: commitMessage,
      content: encodedContent,
      branch: "main",
    };
    if (sha) body.sha = sha;

    await githubRequest(
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
      { method: "PUT", body: JSON.stringify(body) }
    );

    return { path: filePath, status: sha ? "updated" : "created" };
  } catch (err: any) {
    return { path: filePath, status: "error", message: err.message };
  }
}

export async function syncProtocolFiles(
  specificFiles?: string[]
): Promise<{
  success: boolean;
  results: Array<{ path: string; status: string; message?: string }>;
  summary: { created: number; updated: number; unchanged: number; errors: number };
}> {
  const filesToSync = specificFiles
    ? PROTOCOL_FILES.filter((f) => specificFiles.includes(f.path))
    : PROTOCOL_FILES;

  const results: Array<{ path: string; status: string; message?: string }> = [];
  const summary = { created: 0, updated: 0, unchanged: 0, errors: 0 };

  for (const file of filesToSync) {
    const fullPath = path.resolve(process.cwd(), file.localPath);
    if (!fs.existsSync(fullPath)) {
      results.push({ path: file.path, status: "error", message: "File not found locally" });
      summary.errors++;
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const timestamp = new Date().toISOString().split("T")[0];
    const commitMessage = `chore: sync ${file.path} from ClawTrust platform [${timestamp}]`;

    const result = await pushFile(file.path, content, commitMessage);
    results.push(result);
    summary[result.status === "error" ? "errors" : result.status as "created" | "updated" | "unchanged"]++;

    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    success: summary.errors === 0,
    results,
    summary,
  };
}

export async function syncSingleFile(
  localPath: string,
  repoPath: string,
  commitMessage?: string
): Promise<{ path: string; status: string; message?: string }> {
  const fullPath = path.resolve(process.cwd(), localPath);
  if (!fs.existsSync(fullPath)) {
    return { path: repoPath, status: "error", message: "File not found locally" };
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const msg = commitMessage || `chore: update ${repoPath} from ClawTrust platform`;

  return pushFile(repoPath, content, msg);
}

export async function checkGitHubConnection(): Promise<{
  connected: boolean;
  repo?: string;
  message?: string;
}> {
  try {
    const data = await githubRequest(`/repos/${REPO_OWNER}/${REPO_NAME}`);
    return {
      connected: true,
      repo: data.full_name,
      message: `Connected to ${data.full_name} (${data.visibility})`,
    };
  } catch (err: any) {
    return { connected: false, message: err.message };
  }
}

export function getProtocolFileList(): string[] {
  return PROTOCOL_FILES.map((f) => f.path);
}
