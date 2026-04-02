import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, Calendar, Clock, BookOpen } from "lucide-react";
import { SkeletonCard, ErrorState } from "@/components/ui-shared";
import { BlogCoverArt } from "@/components/blog-cover";
import type { BlogPost } from "@shared/schema";

function formatDate(d: string | Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function TagPill({ tag }: { tag: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-mono uppercase tracking-wide"
      style={{ background: "rgba(232,84,10,0.12)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.25)" }}
    >
      {tag}
    </span>
  );
}

function tokenizeCode(raw: string, lang: string): string {
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const solidityKw = new Set(["function","contract","interface","struct","enum","event","modifier","constructor","pragma","import","using","library","mapping","address","uint","uint256","uint128","uint64","uint32","uint16","uint8","int","int256","bool","bytes","bytes32","string","memory","storage","calldata","public","private","internal","external","view","pure","payable","returns","emit","require","revert","delete","new","this","super","override","virtual","abstract","is","if","else","for","while","return","true","false","indexed"]);
  const tsKw = new Set(["import","export","const","let","var","function","class","interface","type","async","await","return","new","if","else","for","while","do","switch","case","break","continue","throw","try","catch","finally","typeof","instanceof","from","as","default","true","false","null","undefined","void","readonly","static","abstract","extends","implements","enum","of","in"]);
  const jsonKw = new Set(["true","false","null"]);
  const kws = lang === "solidity" ? solidityKw : lang === "json" ? jsonKw : tsKw;

  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "/" && raw[i + 1] === "/") {
      const end = raw.indexOf("\n", i);
      const seg = end === -1 ? raw.slice(i) : raw.slice(i, end);
      out += `<span style="color:#64748b">${e(seg)}</span>`; i += seg.length; continue;
    }
    if (raw[i] === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      const seg = end === -1 ? raw.slice(i) : raw.slice(i, end + 2);
      out += `<span style="color:#64748b">${e(seg)}</span>`; i += seg.length; continue;
    }
    if (raw[i] === "#" && lang === "bash") {
      const end = raw.indexOf("\n", i);
      const seg = end === -1 ? raw.slice(i) : raw.slice(i, end);
      out += `<span style="color:#64748b">${e(seg)}</span>`; i += seg.length; continue;
    }
    if (raw[i] === '"' || raw[i] === "'") {
      const q = raw[i]; let j = i + 1;
      while (j < raw.length && raw[j] !== q && raw[j] !== "\n") { if (raw[j] === "\\") j++; j++; }
      const seg = raw.slice(i, j + 1);
      out += `<span style="color:#a3e635">${e(seg)}</span>`; i = j + 1; continue;
    }
    if (raw[i] === "`") {
      let j = i + 1;
      while (j < raw.length && raw[j] !== "`") { if (raw[j] === "\\") j++; j++; }
      out += `<span style="color:#a3e635">${e(raw.slice(i, j + 1))}</span>`; i = j + 1; continue;
    }
    if (/[a-zA-Z_$]/.test(raw[i])) {
      let j = i;
      while (j < raw.length && /[a-zA-Z0-9_$]/.test(raw[j])) j++;
      const word = raw.slice(i, j);
      if (kws.has(word)) {
        out += `<span style="color:#60a5fa">${e(word)}</span>`;
      } else if (raw[j] === "(") {
        out += `<span style="color:#c4b5fd">${e(word)}</span>`;
      } else {
        out += e(word);
      }
      i = j; continue;
    }
    if (/[0-9]/.test(raw[i]) || (raw[i] === "0" && raw[i+1] === "x")) {
      let j = i;
      while (j < raw.length && /[0-9a-fA-Fx._]/.test(raw[j])) j++;
      out += `<span style="color:#fbbf24">${e(raw.slice(i, j))}</span>`; i = j; continue;
    }
    out += e(raw[i]); i++;
  }
  return out;
}

function renderMarkdown(content: string): string {
  const lines = content.split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function flushTable() {
    if (!tableRows.length) return;
    const [header, , ...body] = tableRows;
    let t = `<div style="overflow-x:auto;margin:1.25rem 0"><table style="width:100%;border-collapse:collapse;font-size:13px">`;
    t += `<thead><tr>${header.map(h => `<th style="text-align:left;padding:8px 12px;border-bottom:1px solid rgba(232,84,10,0.3);color:var(--claw-orange);font-family:var(--font-display);font-size:11px;letter-spacing:1px;text-transform:uppercase">${esc(h.trim())}</th>`).join("")}</tr></thead>`;
    t += `<tbody>${body.map((row, i) => `<tr style="border-bottom:1px solid rgba(200,57,26,0.1);background:${i % 2 === 0 ? "transparent" : "rgba(200,57,26,0.04)"}">${row.map(c => `<td style="padding:8px 12px;color:var(--text-muted);font-family:var(--font-mono);font-size:12px">${processInline(c.trim())}</td>`).join("")}</tr>`).join("")}</tbody>`;
    t += `</table></div>`;
    html.push(t);
    tableRows = [];
    inTable = false;
  }

  function processInline(text: string): string {
    return esc(text)
      .replace(/`([^`]+)`/g, `<code style="background:rgba(232,84,10,0.12);color:var(--claw-orange);padding:1px 5px;border-radius:3px;font-family:var(--font-mono);font-size:0.875em">$1</code>`)
      .replace(/\*\*([^*]+)\*\*/g, `<strong style="color:var(--shell-white)">$1</strong>`)
      .replace(/\*([^*]+)\*/g, `<em style="color:var(--text-muted)">$1</em>`);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.slice(3).trim().toLowerCase();
        codeLines = [];
      } else {
        inCodeBlock = false;
        const highlighted = tokenizeCode(codeLines.join("\n"), codeLang);
        const langLabel = codeLang ? `<span style="color:#64748b;font-size:10px;font-family:var(--font-mono);letter-spacing:0.5px">${codeLang}</span>` : "";
        html.push(`<div style="background:#0a0f1a;border:1px solid rgba(96,165,250,0.15);border-radius:6px;margin:1.5rem 0;overflow:hidden"><div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid rgba(96,165,250,0.1);background:rgba(0,0,0,0.3)">${langLabel}</div><div style="padding:16px 20px;overflow-x:auto"><pre style="margin:0;font-family:var(--font-mono);font-size:12.5px;line-height:1.75;color:#e2e8f0">${highlighted}</pre></div></div>`);
        codeLang = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("|")) {
      if (!inTable) inTable = true;
      const cells = line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (line.startsWith("### ")) {
      html.push(`<h3 style="font-family:var(--font-display);font-size:14px;letter-spacing:1.5px;text-transform:uppercase;color:var(--claw-orange);margin:2rem 0 0.75rem">${esc(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      html.push(`<h2 style="font-family:var(--font-display);font-size:17px;letter-spacing:1.5px;text-transform:uppercase;color:var(--shell-white);margin:2.5rem 0 1rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(200,57,26,0.2)">${esc(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      html.push(`<h1 style="font-family:var(--font-display);font-size:22px;letter-spacing:2px;text-transform:uppercase;color:var(--shell-white);margin:0 0 1.5rem">${esc(line.slice(2))}</h1>`);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      html.push(`<li style="color:var(--text-muted);font-size:14px;line-height:1.7;margin:4px 0;padding-left:4px">${processInline(line.slice(2))}</li>`);
    } else if (line.trim() === "") {
      html.push(`<div style="height:0.75rem"></div>`);
    } else {
      html.push(`<p style="color:var(--text-muted);font-size:14px;line-height:1.75;margin:0">${processInline(line)}</p>`);
    }
  }

  if (inTable) flushTable();

  let result = html.join("\n");
  result = result.replace(/(<li[^>]*>[\s\S]*?<\/li>\s*)+/g, match =>
    `<ul style="list-style:disc;padding-left:1.5rem;margin:0.75rem 0">${match}</ul>`
  );
  return result;
}

export default function BlogPostPage() {
  const [, params] = useRoute("/blog/:slug");
  const slug = params?.slug ?? "";

  const { data: post, isLoading, isError } = useQuery<BlogPost>({
    queryKey: ["/api/blog", slug],
    queryFn: async () => {
      const res = await fetch(`/api/blog/${slug}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (isError || !post) {
    return (
      <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <Link href="/blog">
            <button
              className="flex items-center gap-2 text-[11px] uppercase tracking-widest mb-8 hover:opacity-80 transition-opacity"
              style={{ color: "var(--text-muted)" }}
              data-testid="button-back-blog"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Blog
            </button>
          </Link>
          <ErrorState message="Post not found or failed to load." />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <Link href="/blog">
          <button
            className="flex items-center gap-2 text-[11px] uppercase tracking-widest mb-8 hover:opacity-80 transition-opacity"
            style={{ color: "var(--text-muted)" }}
            data-testid="button-back-blog"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Blog
          </button>
        </Link>

        <article>
          <div
            className="w-full rounded-sm overflow-hidden mb-8"
            data-testid="img-post-cover-hero"
          >
            <BlogCoverArt tags={post.tags ?? []} slug={post.slug} height={260} fade />
          </div>

          <header className="mb-8">
            <div className="flex flex-wrap gap-1.5 mb-4">
              {(post.tags || []).map(tag => (
                <TagPill key={tag} tag={tag} />
              ))}
            </div>

            <h1
              className="font-display text-2xl sm:text-3xl tracking-wide mb-4"
              style={{ color: "var(--shell-white)", lineHeight: 1.25 }}
              data-testid="text-post-title"
            >
              {post.title}
            </h1>

            <p
              className="text-sm leading-relaxed mb-5"
              style={{ color: "var(--text-muted)", maxWidth: "60ch" }}
              data-testid="text-post-excerpt"
            >
              {post.excerpt}
            </p>

            <div
              className="flex flex-wrap items-center gap-4 py-4"
              style={{ borderTop: "1px solid rgba(200,57,26,0.15)", borderBottom: "1px solid rgba(200,57,26,0.15)" }}
            >
              <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <BookOpen className="w-3.5 h-3.5" style={{ color: "var(--claw-orange)" }} />
                {post.author}
              </span>
              <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <Calendar className="w-3.5 h-3.5" style={{ color: "var(--claw-orange)" }} />
                {formatDate(post.publishedAt)}
              </span>
              <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <Clock className="w-3.5 h-3.5" style={{ color: "var(--claw-orange)" }} />
                {post.readMinutes} min read
              </span>
            </div>
          </header>

          <div
            className="prose-clawtrust"
            data-testid="div-post-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
          />
        </article>

        <div
          className="mt-12 pt-8"
          style={{ borderTop: "1px solid rgba(200,57,26,0.15)" }}
        >
          <Link href="/blog">
            <button
              className="flex items-center gap-2 text-[11px] font-display uppercase tracking-widest hover:opacity-80 transition-opacity"
              style={{ color: "var(--claw-orange)" }}
              data-testid="button-back-blog-bottom"
            >
              <ArrowLeft className="w-4 h-4" /> All Posts
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
