import fs from "fs";
import path from "path";

const GITHUB_API = "https://api.github.com";
const REPO_OWNER = "clawtrustmolts";
const REPO_NAME = "clawtrustmolts";

interface GitHubFile {
  path: string;
  localPath: string;
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

async function getRef(branch: string): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${branch}`
  );
  return data.object.sha;
}

async function getCommit(sha: string): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${sha}`
  );
  return data.tree.sha;
}

async function createBlob(content: string): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`,
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

async function createTree(
  baseTreeSha: string,
  treeItems: Array<{ path: string; mode: string; type: string; sha: string }>
): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
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

async function createCommit(
  message: string,
  treeSha: string,
  parentSha: string
): Promise<string> {
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
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

async function updateRef(branch: string, commitSha: string): Promise<void> {
  await githubRequest(
    `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: commitSha, force: true }),
    }
  );
}

export async function syncAllFiles(): Promise<{
  success: boolean;
  filesCount: number;
  results: Array<{ path: string; status: string }>;
  message: string;
}> {
  const rootDir = process.cwd();
  const allFiles = discoverFiles(rootDir);
  const results: Array<{ path: string; status: string }> = [];
  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];

  const BATCH_SIZE = 8;
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    const blobResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const content = FILE_OVERRIDES[file.path]
            ?? fs.readFileSync(path.resolve(rootDir, file.localPath), "utf-8");
          const blobSha = await createBlob(content);
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
        results.push({ path: file.path, status: "synced" });
      } else {
        results.push({ path: file.path, status: `error: ${error}` });
      }
    }
  }

  if (treeItems.length === 0) {
    return { success: false, filesCount: 0, results, message: "No files to sync" };
  }

  const branch = "main";
  const headSha = await getRef(branch);
  const baseTreeSha = await getCommit(headSha);

  const MAX_TREE_BATCH = 100;
  let currentTreeSha = baseTreeSha;
  for (let i = 0; i < treeItems.length; i += MAX_TREE_BATCH) {
    const batch = treeItems.slice(i, i + MAX_TREE_BATCH);
    currentTreeSha = await createTree(currentTreeSha, batch);
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const commitMessage = `chore: full platform sync — ${treeItems.length} files [${timestamp}]`;
  const commitSha = await createCommit(commitMessage, currentTreeSha, headSha);
  await updateRef(branch, commitSha);

  return {
    success: true,
    filesCount: treeItems.length,
    results,
    message: `Pushed ${treeItems.length} files to ${REPO_OWNER}/${REPO_NAME} in a single commit`,
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
  const token = getToken();

  const endpoint = `${GITHUB_API}/repos/${REPO_OWNER}/${SKILL_REPO}/contents/clawtrust-integration.md`;

  let sha: string | null = null;
  try {
    const existing = await githubRequest(`/repos/${REPO_OWNER}/${SKILL_REPO}/contents/clawtrust-integration.md`);
    sha = existing.sha || null;
  } catch {}

  const timestamp = new Date().toISOString().split("T")[0];
  const body: any = {
    message: `chore: sync skill from ClawTrust platform [${timestamp}]`,
    content: Buffer.from(content).toString("base64"),
    branch: "main",
  };
  if (sha) body.sha = sha;

  try {
    await githubRequest(`/repos/${REPO_OWNER}/${SKILL_REPO}/contents/clawtrust-integration.md`, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    let readmeSha: string | null = null;
    try {
      const existing = await githubRequest(`/repos/${REPO_OWNER}/${SKILL_REPO}/contents/README.md`);
      readmeSha = existing.sha || null;
    } catch {}

    const readmeContent = `# ClawTrust Integration Skill\n\nOpenClaw agent skill for autonomous reputation building, gig discovery, USDC escrow payments, and swarm validation on the ClawTrust platform.\n\n- **Platform**: [clawtrust.org](https://clawtrust.org)\n- **GitHub**: [github.com/clawtrustmolts/clawtrustmolts](https://github.com/clawtrustmolts/clawtrustmolts)\n- **Chains**: Base Sepolia (EVM), Solana Devnet\n\n## Install\n\nCopy \`clawtrust-integration.md\` into your OpenClaw agent's skills folder:\n\n\`\`\`bash\nmkdir -p ~/.openclaw/skills && curl -o ~/.openclaw/skills/clawtrust-integration.md https://raw.githubusercontent.com/clawtrustmolts/clawtrust-skill/main/clawtrust-integration.md\n\`\`\`\n\nSee the skill file for full API documentation and heartbeat loop examples.\n`;

    const readmeBody: any = {
      message: `chore: update README [${timestamp}]`,
      content: Buffer.from(readmeContent).toString("base64"),
      branch: "main",
    };
    if (readmeSha) readmeBody.sha = readmeSha;

    await githubRequest(`/repos/${REPO_OWNER}/${SKILL_REPO}/contents/README.md`, {
      method: "PUT",
      body: JSON.stringify(readmeBody),
    });

    return { success: true, message: `Synced skill + README to ${REPO_OWNER}/${SKILL_REPO}` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}
