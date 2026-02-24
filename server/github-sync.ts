import fs from "fs";
import path from "path";

const GITHUB_API = "https://api.github.com";
const REPO_OWNER = "clawtrustmolts";
const REPO_NAME = "clawtrustmolts";

interface GitHubFile {
  path: string;
  localPath: string;
}

interface RepoSyncResult {
  repo: string;
  success: boolean;
  filesCount: number;
  message: string;
}

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", ".cache", ".config", ".local", ".upm",
  "attached_assets", "contracts/artifacts", "contracts/cache",
]);

const EXCLUDE_FILES = new Set([
  "replit.md", "replit_zip_error_log.txt", "package-lock.json",
  ".replit", ".gitignore", ".prettierrc",
]);

const CLEAN_VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
`;

const CLEAN_SERVER_VITE = `import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        \`src="/src/main.tsx"\`,
        \`src="/src/main.tsx?v=\${nanoid()}"\`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
`;

const FILE_OVERRIDES: Record<string, string> = {
  "vite.config.ts": CLEAN_VITE_CONFIG,
  "server/vite.ts": CLEAN_SERVER_VITE,
};

const INCLUDE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".css", ".json", ".sol", ".md", ".html",
]);

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

function discoverFiles(rootDir: string, baseDir: string = ""): GitHubFile[] {
  const files: GitHubFile[] = [];
  const entries = fs.readdirSync(path.join(rootDir, baseDir), { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = baseDir ? `${baseDir}/${entry.name}` : entry.name;
    const fullPath = path.join(rootDir, relativePath);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(relativePath) || EXCLUDE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      files.push(...discoverFiles(rootDir, relativePath));
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name) || EXCLUDE_FILES.has(relativePath)) continue;
      if (entry.name.startsWith(".")) continue;
      const ext = path.extname(entry.name);
      if (!INCLUDE_EXTENSIONS.has(ext)) continue;
      const stat = fs.statSync(fullPath);
      if (stat.size > 500_000) continue;
      files.push({ path: relativePath, localPath: relativePath });
    }
  }

  return files;
}

function discoverDirFiles(dirPath: string): GitHubFile[] {
  const rootDir = process.cwd();
  const absDir = path.resolve(rootDir, dirPath);
  if (!fs.existsSync(absDir)) return [];

  const files: GitHubFile[] = [];

  function walk(currentDir: string, relativeBase: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "artifacts" || entry.name === "cache") continue;
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".")) continue;
        const ext = path.extname(entry.name);
        if (!INCLUDE_EXTENSIONS.has(ext)) continue;
        const stat = fs.statSync(fullPath);
        if (stat.size > 500_000) continue;
        files.push({
          path: relPath,
          localPath: `${dirPath}/${relPath}`,
        });
      }
    }
  }

  walk(absDir, "");
  return files;
}

const PROTOCOL_FILES: GitHubFile[] = [
  { path: "README.md", localPath: "README.md" },
  { path: "CONTRIBUTING.md", localPath: "CONTRIBUTING.md" },
  { path: "skills/clawtrust-integration.md", localPath: "skills/clawtrust-integration.md" },
  { path: "shared/clawtrust-sdk/README_SDK.md", localPath: "shared/clawtrust-sdk/README_SDK.md" },
  { path: "shared/clawtrust-sdk/index.ts", localPath: "shared/clawtrust-sdk/index.ts" },
  { path: "contracts/contracts/ClawTrustEscrow.sol", localPath: "contracts/contracts/ClawTrustEscrow.sol" },
  { path: "contracts/contracts/ClawTrustRepAdapter.sol", localPath: "contracts/contracts/ClawTrustRepAdapter.sol" },
  { path: "contracts/contracts/ClawTrustSwarmValidator.sol", localPath: "contracts/contracts/ClawTrustSwarmValidator.sol" },
  { path: "contracts/contracts/ClawCardNFT.sol", localPath: "contracts/contracts/ClawCardNFT.sol" },
  { path: "contracts/scripts/deploy.cjs", localPath: "contracts/scripts/deploy.cjs" },
  { path: "contracts/scripts/verify-deployment.cjs", localPath: "contracts/scripts/verify-deployment.cjs" },
  { path: "contracts/hardhat.config.cjs", localPath: "contracts/hardhat.config.cjs" },
  { path: "shared/schema.ts", localPath: "shared/schema.ts" },
];

async function getRefForRepo(repoName: string, branch: string): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${repoName}/git/ref/heads/${branch}`
  );
  return data.object.sha;
}

async function getCommitForRepo(repoName: string, sha: string): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${repoName}/git/commits/${sha}`
  );
  return data.tree.sha;
}

async function createBlobForRepo(repoName: string, content: string): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${repoName}/git/blobs`,
    {
      method: "POST",
      body: JSON.stringify({
        content: Buffer.from(content).toString("base64"),
        encoding: "base64",
      }),
    }
  );
  return data.sha;
}

async function createTreeForRepo(
  repoName: string,
  baseTreeSha: string,
  treeItems: Array<{ path: string; mode: string; type: string; sha: string }>
): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${repoName}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    }
  );
  return data.sha;
}

async function createCommitForRepo(
  repoName: string,
  message: string,
  treeSha: string,
  parentSha: string
): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${repoName}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha],
      }),
    }
  );
  return data.sha;
}

async function updateRefForRepo(repoName: string, branch: string, commitSha: string): Promise<void> {
  await githubRequest(
    `/repos/${REPO_OWNER}/${repoName}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: commitSha, force: true }),
    }
  );
}

async function pushFilesToRepo(
  repoName: string,
  files: GitHubFile[],
  commitMessage: string,
  fileOverrides?: Record<string, string>
): Promise<RepoSyncResult> {
  const rootDir = process.cwd();
  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  let errorCount = 0;

  const BATCH_SIZE = 8;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const blobResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const content = fileOverrides?.[file.localPath]
            ?? fileOverrides?.[file.path]
            ?? fs.readFileSync(path.resolve(rootDir, file.localPath), "utf-8");
          const blobSha = await createBlobForRepo(repoName, content);
          return { file, blobSha, error: null };
        } catch (err: any) {
          return { file, blobSha: null, error: err.message };
        }
      })
    );

    for (const { file, blobSha, error } of blobResults) {
      if (blobSha) {
        treeItems.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blobSha,
        });
      } else {
        errorCount++;
      }
    }
  }

  if (treeItems.length === 0) {
    return { repo: `${REPO_OWNER}/${repoName}`, success: false, filesCount: 0, message: "No files to sync" };
  }

  const branch = "main";
  const headSha = await getRefForRepo(repoName, branch);
  const baseTreeSha = await getCommitForRepo(repoName, headSha);

  const MAX_TREE_BATCH = 100;
  let currentTreeSha = baseTreeSha;
  for (let i = 0; i < treeItems.length; i += MAX_TREE_BATCH) {
    const batch = treeItems.slice(i, i + MAX_TREE_BATCH);
    currentTreeSha = await createTreeForRepo(repoName, currentTreeSha, batch);
  }

  const commitSha = await createCommitForRepo(repoName, commitMessage, currentTreeSha, headSha);
  await updateRefForRepo(repoName, branch, commitSha);

  return {
    repo: `${REPO_OWNER}/${repoName}`,
    success: true,
    filesCount: treeItems.length,
    message: `Pushed ${treeItems.length} files to ${REPO_OWNER}/${repoName}`,
  };
}

async function pushFileToRepo(
  repoName: string,
  repoFilePath: string,
  content: string,
  commitMessage: string
): Promise<{ path: string; status: "created" | "updated" | "unchanged" | "error"; message?: string }> {
  try {
    let sha: string | null = null;
    try {
      const existing = await githubRequest(`/repos/${REPO_OWNER}/${repoName}/contents/${repoFilePath}`);
      sha = existing.sha || null;
      if (existing.content) {
        const existingContent = Buffer.from(
          existing.content.replace(/\n/g, ""),
          "base64"
        ).toString("utf-8");
        if (existingContent === content) {
          return { path: repoFilePath, status: "unchanged" };
        }
      }
    } catch {}

    const body: any = {
      message: commitMessage,
      content: Buffer.from(content).toString("base64"),
      branch: "main",
    };
    if (sha) body.sha = sha;

    await githubRequest(
      `/repos/${REPO_OWNER}/${repoName}/contents/${repoFilePath}`,
      { method: "PUT", body: JSON.stringify(body) }
    );

    return { path: repoFilePath, status: sha ? "updated" : "created" };
  } catch (err: any) {
    return { path: repoFilePath, status: "error", message: err.message };
  }
}

export async function syncAllFiles(): Promise<{
  success: boolean;
  filesCount: number;
  results: Array<{ path: string; status: string }>;
  message: string;
}> {
  const rootDir = process.cwd();
  const allFiles = discoverFiles(rootDir);
  const result = await pushFilesToRepo(REPO_NAME, allFiles, 
    `chore: full platform sync — ${allFiles.length} files [${new Date().toISOString().split("T")[0]}]`,
    FILE_OVERRIDES
  );

  return {
    success: result.success,
    filesCount: result.filesCount,
    results: allFiles.map(f => ({ path: f.path, status: result.success ? "synced" : "error" })),
    message: result.message,
  };
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
  return pushFileToRepo(REPO_NAME, filePath, content, commitMessage);
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

export function getAllFileList(): string[] {
  const rootDir = process.cwd();
  return discoverFiles(rootDir).map((f) => f.path);
}

export async function syncSkillRepo(): Promise<{
  success: boolean;
  message: string;
}> {
  const SKILL_REPO = "clawtrust-skill";
  const localPath = path.resolve(process.cwd(), "skills/clawtrust-integration.md");
  if (!fs.existsSync(localPath)) {
    return { success: false, message: "Skill file not found locally" };
  }

  const content = fs.readFileSync(localPath, "utf-8");
  const timestamp = new Date().toISOString().split("T")[0];

  try {
    await pushFileToRepo(SKILL_REPO, "clawtrust-integration.md", content,
      `chore: sync skill from ClawTrust platform [${timestamp}]`);

    const readmeContent = `# ClawTrust Integration Skill\n\nOpenClaw agent skill for autonomous reputation building, gig discovery, USDC escrow payments, and swarm validation on the ClawTrust platform.\n\n- **Platform**: [clawtrust.org](https://clawtrust.org)\n- **GitHub**: [github.com/clawtrustmolts/clawtrustmolts](https://github.com/clawtrustmolts/clawtrustmolts)\n- **Chains**: Base Sepolia (EVM), Solana Devnet\n\n## Install\n\nCopy \`clawtrust-integration.md\` into your OpenClaw agent's skills folder:\n\n\`\`\`bash\nmkdir -p ~/.openclaw/skills && curl -o ~/.openclaw/skills/clawtrust-integration.md https://raw.githubusercontent.com/clawtrustmolts/clawtrust-skill/main/clawtrust-integration.md\n\`\`\`\n\nSee the skill file for full API documentation and heartbeat loop examples.\n`;

    await pushFileToRepo(SKILL_REPO, "README.md", readmeContent,
      `chore: update README [${timestamp}]`);

    return { success: true, message: `Synced skill + README to ${REPO_OWNER}/${SKILL_REPO}` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export async function syncContractsRepo(): Promise<RepoSyncResult> {
  const CONTRACTS_REPO = "clawtrust-contracts";
  const timestamp = new Date().toISOString().split("T")[0];

  const files = discoverDirFiles("contracts/contracts");

  const configFiles: GitHubFile[] = [
    { path: "hardhat.config.cjs", localPath: "contracts/hardhat.config.cjs" },
    { path: "package.json", localPath: "contracts/package.json" },
  ];
  const scriptFiles = discoverDirFiles("contracts/scripts").map(f => ({
    path: `scripts/${f.path}`,
    localPath: f.localPath,
  }));

  const contractFiles = files.map(f => ({
    path: `contracts/${f.path}`,
    localPath: f.localPath,
  }));

  const allFiles = [...contractFiles, ...scriptFiles, ...configFiles].filter(f => {
    const fullPath = path.resolve(process.cwd(), f.localPath);
    return fs.existsSync(fullPath);
  });

  const readmeContent = `# ClawTrust Smart Contracts\n\nSolidity contracts for the ClawTrust reputation engine on Base Sepolia.\n\n- **ClawTrustEscrow** — USDC escrow with swarm-validated release\n- **ClawTrustRepAdapter** — ERC-8004 reputation adapter for fused scores\n- **ClawTrustSwarmValidator** — Decentralized swarm validation consensus\n- **ClawCardNFT** — Dynamic reputation-linked NFT cards\n- **ClawTrustBond** — Performance bond staking\n\n## Deploy\n\n\`\`\`bash\nnpx hardhat run scripts/deploy.cjs --network baseSepolia\n\`\`\`\n\nSee [ClawTrust Platform](https://github.com/clawtrustmolts/clawtrustmolts) for full documentation.\n`;

  allFiles.push({
    path: "README.md",
    localPath: "__generated__",
  });

  const overrides: Record<string, string> = {
    "__generated__": readmeContent,
  };

  try {
    const result = await pushFilesToRepo(
      CONTRACTS_REPO,
      allFiles,
      `chore: sync contracts from ClawTrust platform [${timestamp}]`,
      overrides
    );
    return result;
  } catch (err: any) {
    return { repo: `${REPO_OWNER}/${CONTRACTS_REPO}`, success: false, filesCount: 0, message: err.message };
  }
}

export async function syncSdkRepo(): Promise<RepoSyncResult> {
  const SDK_REPO = "clawtrust-sdk";
  const timestamp = new Date().toISOString().split("T")[0];

  const sdkFiles = discoverDirFiles("shared/clawtrust-sdk");

  const schemaFile: GitHubFile = {
    path: "schema.ts",
    localPath: "shared/schema.ts",
  };

  const allFiles = [
    ...sdkFiles,
    schemaFile,
  ].filter(f => {
    const fullPath = path.resolve(process.cwd(), f.localPath);
    return fs.existsSync(fullPath);
  });

  const readmeContent = fs.existsSync(path.resolve(process.cwd(), "shared/clawtrust-sdk/README_SDK.md"))
    ? fs.readFileSync(path.resolve(process.cwd(), "shared/clawtrust-sdk/README_SDK.md"), "utf-8")
    : `# ClawTrust SDK\n\nTypeScript SDK for interacting with the ClawTrust reputation engine.\n\nSee [ClawTrust Platform](https://github.com/clawtrustmolts/clawtrustmolts) for full documentation.\n`;

  allFiles.push({ path: "README.md", localPath: "__sdk_readme__" });

  const overrides: Record<string, string> = {
    "__sdk_readme__": readmeContent,
  };

  try {
    const result = await pushFilesToRepo(
      SDK_REPO,
      allFiles,
      `chore: sync SDK from ClawTrust platform [${timestamp}]`,
      overrides
    );
    return result;
  } catch (err: any) {
    return { repo: `${REPO_OWNER}/${SDK_REPO}`, success: false, filesCount: 0, message: err.message };
  }
}

export async function syncDocsRepo(): Promise<RepoSyncResult> {
  const DOCS_REPO = "clawtrust-docs";
  const timestamp = new Date().toISOString().split("T")[0];
  const rootDir = process.cwd();

  const docFiles: GitHubFile[] = [];

  const topLevelDocs = ["README.md", "CONTRIBUTING.md", "LICENSE"];
  for (const fileName of topLevelDocs) {
    const fullPath = path.resolve(rootDir, fileName);
    if (fs.existsSync(fullPath)) {
      docFiles.push({ path: fileName, localPath: fileName });
    }
  }

  const sdkReadme = path.resolve(rootDir, "shared/clawtrust-sdk/README_SDK.md");
  if (fs.existsSync(sdkReadme)) {
    docFiles.push({ path: "sdk/README.md", localPath: "shared/clawtrust-sdk/README_SDK.md" });
  }

  const skillDoc = path.resolve(rootDir, "skills/clawtrust-integration.md");
  if (fs.existsSync(skillDoc)) {
    docFiles.push({ path: "skills/clawtrust-integration.md", localPath: "skills/clawtrust-integration.md" });
  }

  const docsDir = path.resolve(rootDir, "client/src/pages/docs.tsx");
  if (fs.existsSync(docsDir)) {
    docFiles.push({ path: "app/docs-page.tsx", localPath: "client/src/pages/docs.tsx" });
  }

  try {
    const result = await pushFilesToRepo(
      DOCS_REPO,
      docFiles,
      `chore: sync documentation from ClawTrust platform [${timestamp}]`
    );
    return result;
  } catch (err: any) {
    return { repo: `${REPO_OWNER}/${DOCS_REPO}`, success: false, filesCount: 0, message: err.message };
  }
}

export async function syncOrgProfileRepo(): Promise<RepoSyncResult> {
  const ORG_PROFILE_REPO = ".github";
  const timestamp = new Date().toISOString().split("T")[0];

  const profileReadme = `# ClawTrust

**The reputation engine for the agentic economy.**

ClawTrust is an open-source, multi-chain reputation and escrow protocol where AI agents earn trust through verifiable work, swarm validation, and on-chain reputation scores.

## Repositories

| Repo | Description |
|------|-------------|
| [clawtrustmolts](https://github.com/clawtrustmolts/clawtrustmolts) | Full platform (dApp, API, frontend) |
| [clawtrust-contracts](https://github.com/clawtrustmolts/clawtrust-contracts) | Solidity smart contracts (Base Sepolia) |
| [clawtrust-sdk](https://github.com/clawtrustmolts/clawtrust-sdk) | TypeScript SDK for integration |
| [clawtrust-skill](https://github.com/clawtrustmolts/clawtrust-skill) | OpenClaw agent skill file |
| [clawtrust-docs](https://github.com/clawtrustmolts/clawtrust-docs) | Documentation and guides |
| [openclaw](https://github.com/clawtrustmolts/openclaw) | OpenClaw framework |

## Links

- **Platform**: [clawtrust.org](https://clawtrust.org)
- **Standard**: ERC-8004 (Identity, Reputation, Validation)
- **Chains**: Base Sepolia, Solana Devnet
`;

  const files: GitHubFile[] = [
    { path: "profile/README.md", localPath: "__org_profile__" },
  ];

  const overrides: Record<string, string> = {
    "__org_profile__": profileReadme,
  };

  try {
    const result = await pushFilesToRepo(
      ORG_PROFILE_REPO,
      files,
      `chore: update org profile [${timestamp}]`,
      overrides
    );
    return result;
  } catch (err: any) {
    return { repo: `${REPO_OWNER}/${ORG_PROFILE_REPO}`, success: false, filesCount: 0, message: err.message };
  }
}

export async function syncAllRepos(): Promise<{
  success: boolean;
  repos: RepoSyncResult[];
  totalFiles: number;
  message: string;
}> {
  const repos: RepoSyncResult[] = [];
  let totalFiles = 0;

  const syncTasks: Array<{ name: string; fn: () => Promise<RepoSyncResult | { success: boolean; message: string }> }> = [
    {
      name: "clawtrustmolts (full platform)",
      fn: async () => {
        const result = await syncAllFiles();
        return {
          repo: `${REPO_OWNER}/${REPO_NAME}`,
          success: result.success,
          filesCount: result.filesCount,
          message: result.message,
        };
      },
    },
    {
      name: "clawtrust-skill",
      fn: async () => {
        const result = await syncSkillRepo();
        return {
          repo: `${REPO_OWNER}/clawtrust-skill`,
          success: result.success,
          filesCount: result.success ? 2 : 0,
          message: result.message,
        };
      },
    },
    { name: "clawtrust-contracts", fn: syncContractsRepo },
    { name: "clawtrust-sdk", fn: syncSdkRepo },
    { name: "clawtrust-docs", fn: syncDocsRepo },
    { name: ".github (org profile)", fn: syncOrgProfileRepo },
  ];

  for (const task of syncTasks) {
    try {
      console.log(`[GitSync] Syncing ${task.name}...`);
      const result = await task.fn();
      const repoResult: RepoSyncResult = {
        repo: (result as RepoSyncResult).repo || task.name,
        success: result.success,
        filesCount: (result as RepoSyncResult).filesCount || 0,
        message: result.message,
      };
      repos.push(repoResult);
      totalFiles += repoResult.filesCount;
      console.log(`[GitSync] ${task.name}: ${result.success ? "OK" : "FAILED"} — ${result.message}`);
    } catch (err: any) {
      repos.push({
        repo: task.name,
        success: false,
        filesCount: 0,
        message: err.message,
      });
      console.error(`[GitSync] ${task.name} failed: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  const allSuccess = repos.every(r => r.success);
  const successCount = repos.filter(r => r.success).length;

  return {
    success: allSuccess,
    repos,
    totalFiles,
    message: `Synced ${successCount}/${repos.length} repos, ${totalFiles} total files`,
  };
}
