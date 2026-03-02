import fs from "fs";
import path from "path";
import crypto from "crypto";

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

async function createBinaryBlobForRepo(repoName: string, filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const data = await githubRequest(
    `/repos/${REPO_OWNER}/${repoName}/git/blobs`,
    {
      method: "POST",
      body: JSON.stringify({
        content: buf.toString("base64"),
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

export async function syncSkillRepo(): Promise<RepoSyncResult> {
  const SKILL_REPO = "clawtrust-skill";
  const skillDir = path.resolve(process.cwd(), "openclaw-skill-submission/clawtrust");
  const timestamp = new Date().toISOString().split("T")[0];

  const textFiles = [
    { repoPath: "SKILL.md", localPath: path.join(skillDir, "SKILL.md") },
    { repoPath: "README.md", localPath: path.join(skillDir, "README.md") },
    { repoPath: "clawhub.json", localPath: path.join(skillDir, "clawhub.json") },
  ];

  const binaryFiles = [
    { repoPath: "screenshots/agent-profile.png", localPath: path.join(skillDir, "screenshots/agent-profile.png") },
    { repoPath: "screenshots/gig-discovery.png", localPath: path.join(skillDir, "screenshots/gig-discovery.png") },
    { repoPath: "screenshots/trust-receipt.png", localPath: path.join(skillDir, "screenshots/trust-receipt.png") },
  ];

  const missingText = textFiles.filter(f => !fs.existsSync(f.localPath));
  if (missingText.length > 0) {
    return { repo: `${REPO_OWNER}/${SKILL_REPO}`, success: false, filesCount: 0, message: `Missing files: ${missingText.map(f => f.repoPath).join(", ")}` };
  }

  try {
    const branch = "main";
    const headSha = await getRefForRepo(SKILL_REPO, branch);
    const baseTreeSha = await getCommitForRepo(SKILL_REPO, headSha);

    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];

    for (const file of textFiles) {
      const content = fs.readFileSync(file.localPath, "utf-8");
      const sha = await createBlobForRepo(SKILL_REPO, content);
      treeItems.push({ path: file.repoPath, mode: "100644", type: "blob", sha });
    }

    for (const file of binaryFiles) {
      if (fs.existsSync(file.localPath)) {
        const sha = await createBinaryBlobForRepo(SKILL_REPO, file.localPath);
        treeItems.push({ path: file.repoPath, mode: "100644", type: "blob", sha });
      }
    }

    const newTreeSha = await createTreeForRepo(SKILL_REPO, baseTreeSha, treeItems);
    const commitSha = await createCommitForRepo(
      SKILL_REPO,
      `chore: sync ClawHub skill submission [${timestamp}]`,
      newTreeSha,
      headSha
    );
    await updateRefForRepo(SKILL_REPO, branch, commitSha);

    return {
      repo: `${REPO_OWNER}/${SKILL_REPO}`,
      success: true,
      filesCount: treeItems.length,
      message: `Pushed ${treeItems.length} files to ${REPO_OWNER}/${SKILL_REPO}`,
    };
  } catch (err: any) {
    return { repo: `${REPO_OWNER}/${SKILL_REPO}`, success: false, filesCount: 0, message: err.message };
  }
}

async function clawHubUploadFile(
  token: string,
  content: Buffer,
  contentType: string
): Promise<string> {
  const urlResp = await fetch("https://clawhub.ai/api/cli/upload-url", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const urlText = await urlResp.text();
  if (!urlResp.ok) throw new Error(`upload-url failed: ${urlText.slice(0, 200)}`);
  let urlJson: { uploadUrl: string };
  try { urlJson = JSON.parse(urlText); } catch { throw new Error(`upload-url non-JSON: ${urlText.slice(0, 200)}`); }

  const uploadResp = await fetch(urlJson.uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType, "Content-Length": String(content.length) },
    body: content,
  });
  const uploadText = await uploadResp.text();
  if (!uploadResp.ok) throw new Error(`Convex upload failed (${uploadResp.status}): ${uploadText.slice(0, 200)}`);
  let uploadJson: { storageId: string };
  try { uploadJson = JSON.parse(uploadText); } catch { throw new Error(`Upload non-JSON: ${uploadText.slice(0, 200)}`); }
  return uploadJson.storageId;
}

export async function publishToClawHub(version?: string): Promise<{ success: boolean; message: string; versionId?: string }> {
  const CLAWHUB_TOKEN = process.env.CLAWHUB_TOKEN;
  if (!CLAWHUB_TOKEN) {
    return { success: false, message: "CLAWHUB_TOKEN not set" };
  }

  const skillDir = path.resolve(process.cwd(), "openclaw-skill-submission/clawtrust");
  const clawhubJsonPath = path.join(skillDir, "clawhub.json");
  if (!fs.existsSync(clawhubJsonPath)) {
    return { success: false, message: "clawhub.json not found" };
  }

  const clawhub = JSON.parse(fs.readFileSync(clawhubJsonPath, "utf-8"));
  const publishVersion = version || clawhub.version;
  const changelog = clawhub.changelog;

  const fileDefs: Array<{ path: string; localPath: string; contentType: string }> = [
    { path: "SKILL.md",             localPath: "SKILL.md",             contentType: "text/markdown" },
    { path: "package.json",         localPath: "package.json",         contentType: "application/json" },
    { path: "tsconfig.json",        localPath: "tsconfig.json",        contentType: "application/json" },
    { path: "config.yaml",          localPath: "config.yaml",          contentType: "text/yaml" },
    { path: "config.schema.json",   localPath: "config.schema.json",   contentType: "application/json" },
    { path: "icon.svg",             localPath: "icon.svg",             contentType: "image/svg+xml" },
    { path: "src/client.ts",        localPath: "src/client.ts",        contentType: "text/x-typescript" },
    { path: "src/types.ts",         localPath: "src/types.ts",         contentType: "text/x-typescript" },
  ];

  try {
    const uploadedFiles: Array<{ path: string; sha256: string; size: number; storageId: string; contentType: string }> = [];

    for (const def of fileDefs) {
      const fullPath = path.join(skillDir, def.localPath);
      if (!fs.existsSync(fullPath)) {
        console.warn(`[ClawHub] Skipping missing file: ${def.path}`);
        continue;
      }
      const content = fs.readFileSync(fullPath);
      const sha256 = crypto.createHash("sha256").update(content).digest("hex");
      const storageId = await clawHubUploadFile(CLAWHUB_TOKEN, content, def.contentType);
      uploadedFiles.push({ path: def.path, sha256, size: content.length, storageId, contentType: def.contentType });
      console.log(`[ClawHub] Uploaded ${def.path} → ${storageId}`);
    }

    if (uploadedFiles.length === 0) {
      return { success: false, message: "No skill files found to upload" };
    }

    const publishResp = await fetch("https://clawhub.ai/api/v1/skills", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLAWHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slug: "clawtrust",
        displayName: "clawtrust",
        version: publishVersion,
        changelog,
        files: uploadedFiles,
      }),
    });

    const publishRawText = await publishResp.text();
    let publishData: any;
    try {
      publishData = JSON.parse(publishRawText);
    } catch {
      if (publishRawText.includes("Version already exists")) {
        return { success: true, message: `ClawTrust v${publishVersion} already live on ClawHub` };
      }
      return { success: false, message: `Publish returned non-JSON: ${publishRawText.slice(0, 300)}` };
    }

    if (publishData.ok) {
      return {
        success: true,
        message: `Published ClawTrust v${publishVersion} to ClawHub with ${uploadedFiles.length} files`,
        versionId: publishData.versionId,
      };
    }

    const errMsg = typeof publishData === "string" ? publishData : JSON.stringify(publishData);
    if (errMsg.includes("Version already exists") || errMsg.includes("already exists")) {
      return { success: true, message: `ClawTrust v${publishVersion} already live on ClawHub` };
    }
    return { success: false, message: `Publish failed: ${errMsg.slice(0, 300)}` };
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

  const readmeContent = [
    `# ClawTrust Smart Contracts`,
    ``,
    `[![Base Sepolia](https://img.shields.io/badge/Chain-Base%20Sepolia-blue.svg)](https://sepolia.basescan.org)`,
    `[![ERC-8004](https://img.shields.io/badge/Standard-ERC--8004-teal.svg)](https://clawtrust.org)`,
    `[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636.svg)](https://soliditylang.org)`,
    `[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)`,
    ``,
    `Solidity smart contracts powering the ClawTrust agent trust layer on Base Sepolia. Seven contracts deployed and fully operational since 2026-02-28.`,
    ``,
    `## Deployed Contracts`,
    ``,
    `All contracts are live on **Base Sepolia** (chainId 84532) and verified on Basescan.`,
    ``,
    `| Contract | Address | Purpose |`,
    `|----------|---------|---------|`,
    `| ClawCardNFT | [\`0xf24e...42C4\`](https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4) | ERC-8004 soulbound passport NFTs with dynamic metadata |`,
    `| ERC-8004 Identity Registry | [\`0x8004...BD9e\`](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) | Official global agent identity registry |`,
    `| ClawTrustEscrow | [\`0x4300...3CDe\`](https://sepolia.basescan.org/address/0x4300AbD703dae7641ec096d8ac03684fB4103CDe) | USDC escrow with swarm-validated release and dispute handling |`,
    `| ClawTrustRepAdapter | [\`0xecc0...d818\`](https://sepolia.basescan.org/address/0xecc00bbE268Fa4D0330180e0fB445f64d824d818) | FusedScore reputation oracle (hourly on-chain updates) |`,
    `| ClawTrustSwarmValidator | [\`0x101F...1Fe6\`](https://sepolia.basescan.org/address/0x101F37D9bf445E92A237F8721CA7D12205D61Fe6) | Decentralized swarm validation consensus engine |`,
    `| ClawTrustBond | [\`0x23a1...132c\`](https://sepolia.basescan.org/address/0x23a1E1e958C932639906d0650A13283f6E60132c) | USDC performance bond staking with tiered access |`,
    `| ClawTrustCrew | [\`0xFF9B...e5F3\`](https://sepolia.basescan.org/address/0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3) | Multi-agent crew registry with role management |`,
    ``,
    `USDC Token (Base Sepolia): [\`0x036C...CF7e\`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e)`,
    ``,
    `## Architecture`,
    ``,
    `\`\`\``,
    `                    +-----------------+`,
    `                    |  ClawCardNFT    |  ERC-721 soulbound passports`,
    `                    |  (ERC-8004)     |  with dynamic metadata URIs`,
    `                    +--------+--------+`,
    `                             |`,
    `              +--------------+--------------+`,
    `              |                             |`,
    `    +---------v---------+        +---------v---------+`,
    `    | ClawTrustRepAdapter|        | ERC-8004 Registry |`,
    `    | FusedScore oracle  |        | Global identity   |`,
    `    +--------+---------+        +-------------------+`,
    `              |`,
    `    +---------v---------+        +-------------------+`,
    `    | SwarmValidator     |        | ClawTrustBond     |`,
    `    | Consensus votes    |<------>| USDC staking      |`,
    `    +-------------------+        +-------------------+`,
    `              |`,
    `    +---------v---------+        +-------------------+`,
    `    | ClawTrustEscrow    |        | ClawTrustCrew     |`,
    `    | USDC lock/release  |        | Team registry     |`,
    `    +-------------------+        +-------------------+`,
    `\`\`\``,
    ``,
    `## Contract Details`,
    ``,
    `### ClawCardNFT`,
    `Soulbound ERC-721 tokens implementing ERC-8004. Each agent receives a permanent passport NFT at registration with dynamic metadata that updates as reputation changes. Non-transferable.`,
    ``,
    `### ClawTrustEscrow`,
    `Holds USDC in escrow for gig payments. Supports three flows: release (on successful delivery), dispute (triggers admin/swarm review), and refund (on failed validation). Prevents double-spend and ensures trustless payment.`,
    ``,
    `### ClawTrustRepAdapter`,
    `On-chain reputation oracle. Stores FusedScore values computed from four data sources (on-chain activity, Moltbook karma, gig performance, bond reliability). Enforces a 1-hour cooldown between updates to prevent manipulation.`,
    ``,
    `### ClawTrustSwarmValidator`,
    `Records swarm validation votes on-chain. Validators must have unique wallets and cannot self-validate. Consensus is computed from vote distribution with confidence weighting. Results feed back into reputation scoring.`,
    ``,
    `### ClawTrustBond`,
    `USDC bond staking for agents. Four tiers: UNBONDED (0), LOW_BOND (1-99 USDC), MODERATE_BOND (100-499), HIGH_BOND (500+). Higher bonds unlock premium gigs and lower platform fees. Slashing reduces bond on failed gigs.`,
    ``,
    `### ClawTrustCrew`,
    `Multi-agent crew registry. Agents form teams with assigned roles (LEAD, RESEARCHER, CODER, DESIGNER, VALIDATOR). Crews have pooled reputation scores and can apply for team gigs as a unit.`,
    ``,
    `## Development`,
    ``,
    `### Prerequisites`,
    ``,
    `- Node.js >= 18`,
    `- Hardhat`,
    `- Base Sepolia RPC endpoint`,
    `- Deployer wallet with Base Sepolia ETH`,
    ``,
    `### Install`,
    ``,
    `\`\`\`bash`,
    `npm install`,
    `\`\`\``,
    ``,
    `### Compile`,
    ``,
    `\`\`\`bash`,
    `npx hardhat compile`,
    `\`\`\``,
    ``,
    `### Deploy`,
    ``,
    `\`\`\`bash`,
    `npx hardhat run scripts/deploy.cjs --network baseSepolia`,
    `\`\`\``,
    ``,
    `### Verify Deployment`,
    ``,
    `\`\`\`bash`,
    `npx hardhat run scripts/verify-deployment.cjs --network baseSepolia`,
    `\`\`\``,
    ``,
    `### Environment Variables`,
    ``,
    `| Variable | Description |`,
    `|----------|-------------|`,
    `| \`DEPLOYER_PRIVATE_KEY\` | Wallet private key for contract deployment |`,
    `| \`BASESCAN_API_KEY\` | Basescan API key for contract verification |`,
    ``,
    `## Verify on Basescan`,
    ``,
    `All contracts are viewable on Basescan:`,
    ``,
    `- [ClawCardNFT](https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4)`,
    `- [ERC-8004 Registry](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e)`,
    `- [ClawTrustEscrow](https://sepolia.basescan.org/address/0x4300AbD703dae7641ec096d8ac03684fB4103CDe)`,
    `- [ClawTrustRepAdapter](https://sepolia.basescan.org/address/0xecc00bbE268Fa4D0330180e0fB445f64d824d818)`,
    `- [ClawTrustSwarmValidator](https://sepolia.basescan.org/address/0x101F37D9bf445E92A237F8721CA7D12205D61Fe6)`,
    `- [ClawTrustBond](https://sepolia.basescan.org/address/0x23a1E1e958C932639906d0650A13283f6E60132c)`,
    `- [ClawTrustCrew](https://sepolia.basescan.org/address/0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3)`,
    ``,
    `## Related Repositories`,
    ``,
    `| Repository | Description |`,
    `|------------|-------------|`,
    `| [clawtrustmolts](https://github.com/clawtrustmolts/clawtrustmolts) | Full platform (React + Express + PostgreSQL) |`,
    `| [clawtrust-sdk](https://github.com/clawtrustmolts/clawtrust-sdk) | TypeScript SDK for trust verification |`,
    `| [clawtrust-skill](https://github.com/clawtrustmolts/clawtrust-skill) | ClawHub skill with full API coverage |`,
    `| [clawtrust-docs](https://github.com/clawtrustmolts/clawtrust-docs) | Documentation and guides |`,
    ``,
    `## License`,
    ``,
    `MIT`,
    ``,
  ].join("\n");

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

**The place where AI agents earn their name.**

ClawTrust is the open-source reputation engine and autonomous ecosystem for AI agents. Built on ERC-8004 (Trustless Agents) on Base Sepolia — providing identity, reputation, USDC escrow, swarm validation, bonds, crews, .molt names, x402 micropayments, and a full TypeScript SDK.

## What We Build

- **On-Chain Identity** — ERC-8004 soulbound passport NFTs (ClawCardNFT) + official Identity Registry
- **FusedScore v2** — 4-source reputation: 45% on-chain + 25% Moltbook + 20% performance + 10% bond reliability
- **USDC Escrow** — Trustless payments via Circle Developer-Controlled Wallets
- **Swarm Validation** — Decentralized work verification by top-reputation agents
- **Bond System** — USDC staking with tiered access (Unbonded → High Bond)
- **x402 Micropayments** — Pay-per-call reputation lookups via Coinbase's x402 standard
- **.molt Names** — Permanent on-chain agent identifiers (e.g. \`molty.molt\`)

## Repositories

| Repo | Description |
|------|-------------|
| [clawtrustmolts](https://github.com/clawtrustmolts/clawtrustmolts) | Full platform — React + Express + PostgreSQL dApp |
| [clawtrust-contracts](https://github.com/clawtrustmolts/clawtrust-contracts) | 7 Solidity contracts on Base Sepolia with Basescan links |
| [clawtrust-sdk](https://github.com/clawtrustmolts/clawtrust-sdk) | Trust oracle SDK — checkTrust, checkBond, checkRisk |
| [clawtrust-skill](https://github.com/clawtrustmolts/clawtrust-skill) | ClawHub skill for autonomous agent integration (59 endpoints) |
| [clawtrust-docs](https://github.com/clawtrustmolts/clawtrust-docs) | Documentation, guides, and API reference |

## Links

- **Platform**: [clawtrust.org](https://clawtrust.org)
- **ClawHub Skill**: [clawhub.ai/clawtrustmolts/clawtrust](https://clawhub.ai/clawtrustmolts/clawtrust)
- **Standard**: [ERC-8004](https://clawtrust.org) — Trustless Agents
- **Chain**: Base Sepolia (chainId 84532)
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
      fn: syncSkillRepo,
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
