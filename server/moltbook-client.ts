import * as cheerio from "cheerio";

const MOLTBOOK_API_BASE = "https://moltbook.com/api";
const MOLTBOOK_IO_BASE = "https://moltbook.io";

const FETCH_TIMEOUT_MS = 5000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const CACHE_TTL_MS = 5 * 60_000;

export interface MoltbookAgentData {
  handle: string;
  karma: number;
  postCount: number;
  followers: number;
  topPosts: MoltbookPost[];
  profileUrl: string;
  source: "api" | "scrape" | "cached";
  fetchedAt: number;
  error?: string;
}

export interface MoltbookPost {
  id: string;
  title: string;
  url: string;
  likes: number;
  comments: number;
  shares: number;
  submolt: string;
  postedAt: string;
}

export interface MoltbookViralScore {
  viralBonus: number;
  totalInteractions: number;
  weightedScore: number;
  postCount: number;
}

export interface MoltbookNormalized {
  moltbookNormalized: number;
  rawKarma: number;
  viralBonus: number;
  source: "api" | "scrape" | "cached" | "db_fallback";
  error?: string;
}

const moltbookCache = new Map<string, { data: MoltbookAgentData; cachedAt: number }>();

const rateLimitState = { count: 0, windowStart: Date.now() };

function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - rateLimitState.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.count = 0;
    rateLimitState.windowStart = now;
  }
  if (rateLimitState.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  rateLimitState.count++;
  return true;
}

function getCachedData(handle: string): MoltbookAgentData | null {
  const entry = moltbookCache.get(handle.toLowerCase());
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    moltbookCache.delete(handle.toLowerCase());
    return null;
  }
  return { ...entry.data, source: "cached" };
}

function setCachedData(handle: string, data: MoltbookAgentData): void {
  moltbookCache.set(handle.toLowerCase(), { data, cachedAt: Date.now() });
}

async function fetchWithTimeout(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ClawTrust-RepEngine/1.0",
        "Accept": "application/json, text/html",
      },
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromMoltbookAPI(handle: string): Promise<MoltbookAgentData | null> {
  const endpoints = [
    `${MOLTBOOK_API_BASE}/agent/${encodeURIComponent(handle)}/karma`,
    `${MOLTBOOK_API_BASE}/v1/users/${encodeURIComponent(handle)}/profile`,
    `${MOLTBOOK_API_BASE}/agent/${encodeURIComponent(handle)}/posts`,
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`[moltbook] Trying API: ${endpoint}`);
      const resp = await fetchWithTimeout(endpoint);

      if (!resp.ok) {
        console.log(`[moltbook] API ${endpoint} returned ${resp.status}`);
        continue;
      }

      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        console.log(`[moltbook] API ${endpoint} returned non-JSON content-type: ${contentType}`);
        continue;
      }

      const json = await resp.json();

      const data: MoltbookAgentData = {
        handle,
        karma: json.karma ?? json.reputation?.karma ?? json.score ?? 0,
        postCount: json.postCount ?? json.posts?.length ?? json.stats?.posts ?? 0,
        followers: json.followers ?? json.stats?.followers ?? 0,
        topPosts: parseAPIPosts(json.posts || json.topPosts || json.recentPosts || []),
        profileUrl: `${MOLTBOOK_IO_BASE}/@${handle}`,
        source: "api",
        fetchedAt: Date.now(),
      };

      console.log(`[moltbook] API success for ${handle}: karma=${data.karma}, posts=${data.postCount}`);
      return data;
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.warn(`[moltbook] API timeout for ${endpoint}`);
      } else {
        console.warn(`[moltbook] API error for ${endpoint}: ${err.message}`);
      }
    }
  }

  return null;
}

function parseAPIPosts(posts: any[]): MoltbookPost[] {
  if (!Array.isArray(posts)) return [];
  return posts.slice(0, 10).map((p: any, i: number) => ({
    id: p.id || p._id || `post-${i}`,
    title: p.title || p.content?.substring(0, 80) || `Post ${i + 1}`,
    url: p.url || p.link || `${MOLTBOOK_IO_BASE}/post/${p.id || i}`,
    likes: p.likes ?? p.upvotes ?? p.score ?? 0,
    comments: p.comments ?? p.commentCount ?? p.replies ?? 0,
    shares: p.shares ?? p.reposts ?? 0,
    submolt: p.submolt ?? p.community ?? p.subreddit ?? "general",
    postedAt: p.postedAt ?? p.createdAt ?? p.date ?? new Date().toISOString(),
  }));
}

async function scrapeFromMoltbookProfile(handle: string, moltbookLink?: string | null): Promise<MoltbookAgentData | null> {
  const urls = [
    moltbookLink,
    `${MOLTBOOK_IO_BASE}/@${handle}`,
    `${MOLTBOOK_IO_BASE}/user/${handle}`,
    `https://moltbook.com/@${handle}`,
  ].filter(Boolean) as string[];

  for (const url of urls) {
    try {
      console.log(`[moltbook] Trying scrape: ${url}`);
      const resp = await fetchWithTimeout(url);

      if (!resp.ok) {
        console.log(`[moltbook] Scrape ${url} returned ${resp.status}`);
        continue;
      }

      const html = await resp.text();
      const $ = cheerio.load(html);

      const karmaSelectors = [
        '[data-testid="karma-count"]',
        ".karma-score",
        ".user-karma",
        '[class*="karma"]',
        ".reputation-score",
        '[data-karma]',
      ];

      let karma = 0;
      for (const sel of karmaSelectors) {
        const el = $(sel).first();
        if (el.length) {
          const text = el.attr("data-karma") || el.text();
          const parsed = parseInt(text.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(parsed) && parsed > 0) {
            karma = parsed;
            break;
          }
        }
      }

      const postCountSelectors = [
        '[data-testid="post-count"]',
        ".post-count",
        ".user-posts",
        '[class*="post-count"]',
      ];

      let postCount = 0;
      for (const sel of postCountSelectors) {
        const el = $(sel).first();
        if (el.length) {
          const parsed = parseInt(el.text().replace(/[^0-9]/g, ""), 10);
          if (!isNaN(parsed)) {
            postCount = parsed;
            break;
          }
        }
      }

      let followers = 0;
      const followerEl = $('[data-testid="follower-count"], .follower-count, .followers').first();
      if (followerEl.length) {
        const parsed = parseInt(followerEl.text().replace(/[^0-9]/g, ""), 10);
        if (!isNaN(parsed)) followers = parsed;
      }

      const posts: MoltbookPost[] = [];
      $(".post-card, .moltbook-post, article, [data-testid*='post']").each((i: number, el: cheerio.Element) => {
        if (i >= 10) return;
        const $el = $(el);
        posts.push({
          id: $el.attr("data-post-id") || `scraped-${i}`,
          title: $el.find("h2, h3, .post-title, .title").first().text().trim().substring(0, 100) || `Post ${i + 1}`,
          url: $el.find("a").first().attr("href") || url,
          likes: parseInt($el.find('.likes, .upvotes, [data-likes]').first().text().replace(/[^0-9]/g, ""), 10) || 0,
          comments: parseInt($el.find('.comments, .replies, [data-comments]').first().text().replace(/[^0-9]/g, ""), 10) || 0,
          shares: parseInt($el.find('.shares, .reposts, [data-shares]').first().text().replace(/[^0-9]/g, ""), 10) || 0,
          submolt: $el.find(".submolt, .community").first().text().trim() || "general",
          postedAt: $el.attr("data-posted-at") || new Date().toISOString(),
        });
      });

      if (karma > 0 || posts.length > 0) {
        const data: MoltbookAgentData = {
          handle,
          karma,
          postCount: postCount || posts.length,
          followers,
          topPosts: posts,
          profileUrl: url,
          source: "scrape",
          fetchedAt: Date.now(),
        };
        console.log(`[moltbook] Scrape success for ${handle}: karma=${karma}, posts=${posts.length}`);
        return data;
      }

      console.log(`[moltbook] Scrape ${url}: no parseable data found in HTML`);
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.warn(`[moltbook] Scrape timeout for ${url}`);
      } else {
        console.warn(`[moltbook] Scrape error for ${url}: ${err.message}`);
      }
    }
  }

  return null;
}

export function computeViralScore(posts: MoltbookPost[]): MoltbookViralScore {
  if (!posts || posts.length === 0) {
    return { viralBonus: 0, totalInteractions: 0, weightedScore: 0, postCount: 0 };
  }

  let totalInteractions = 0;
  let weightedScore = 0;

  for (const post of posts) {
    const interactions = post.likes + post.comments * 2 + post.shares * 3;
    totalInteractions += interactions;
    weightedScore += Math.log2(1 + interactions) * 2;
  }

  const viralBonus = Math.min(Math.round(weightedScore * 10) / 10, 15);

  return {
    viralBonus,
    totalInteractions,
    weightedScore: Math.round(weightedScore * 10) / 10,
    postCount: posts.length,
  };
}

const MAX_MOLTBOOK_KARMA = 10000;

export function normalizeMoltbookScore(karma: number, viralBonus: number): number {
  const baseNormalized = Math.min(karma / MAX_MOLTBOOK_KARMA, 1) * 100;
  return Math.min(Math.round((baseNormalized + viralBonus) * 10) / 10, 100);
}

export async function fetchMoltbookData(
  handle: string,
  moltbookLink?: string | null
): Promise<MoltbookAgentData> {
  const cached = getCachedData(handle);
  if (cached) {
    console.log(`[moltbook] Cache hit for ${handle}`);
    return cached;
  }

  if (!checkRateLimit()) {
    console.warn(`[moltbook] Rate limit reached, using cache/fallback for ${handle}`);
    const stale = moltbookCache.get(handle.toLowerCase());
    if (stale) {
      return { ...stale.data, source: "cached", error: "Rate limited - using stale cache" };
    }
    return {
      handle,
      karma: 0,
      postCount: 0,
      followers: 0,
      topPosts: [],
      profileUrl: moltbookLink || `${MOLTBOOK_IO_BASE}/@${handle}`,
      source: "cached",
      fetchedAt: Date.now(),
      error: "Rate limited - no cached data available",
    };
  }

  const apiData = await fetchFromMoltbookAPI(handle);
  if (apiData) {
    setCachedData(handle, apiData);
    return apiData;
  }

  const scrapeData = await scrapeFromMoltbookProfile(handle, moltbookLink);
  if (scrapeData) {
    setCachedData(handle, scrapeData);
    return scrapeData;
  }

  console.log(`[moltbook] All fetch methods failed for ${handle}, returning empty with error`);
  const fallbackData: MoltbookAgentData = {
    handle,
    karma: 0,
    postCount: 0,
    followers: 0,
    topPosts: [],
    profileUrl: moltbookLink || `${MOLTBOOK_IO_BASE}/@${handle}`,
    source: "cached",
    fetchedAt: Date.now(),
    error: "Moltbook API and scrape both unavailable - using DB fallback",
  };

  return fallbackData;
}

export async function fetchPostData(postUrl: string): Promise<{
  post: MoltbookPost | null;
  karma: number;
  handle: string | null;
  source: "api" | "scrape" | "unavailable";
  error?: string;
}> {
  if (!checkRateLimit()) {
    return { post: null, karma: 0, handle: null, source: "unavailable", error: "Rate limited" };
  }

  try {
    const apiUrl = postUrl
      .replace("moltbook.io/post/", "moltbook.com/api/post/")
      .replace("moltbook.com/post/", "moltbook.com/api/post/");

    try {
      console.log(`[moltbook] Fetching post API: ${apiUrl}`);
      const resp = await fetchWithTimeout(apiUrl);
      if (resp.ok) {
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await resp.json();
          return {
            post: {
              id: json.id || "unknown",
              title: json.title || json.content?.substring(0, 80) || "Moltbook Post",
              url: postUrl,
              likes: json.likes ?? json.upvotes ?? 0,
              comments: json.comments ?? json.commentCount ?? 0,
              shares: json.shares ?? json.reposts ?? 0,
              submolt: json.submolt ?? json.community ?? "general",
              postedAt: json.postedAt ?? json.createdAt ?? new Date().toISOString(),
            },
            karma: json.author?.karma ?? json.authorKarma ?? 0,
            handle: json.author?.handle ?? json.authorHandle ?? null,
            source: "api",
          };
        }
      }
    } catch (err: any) {
      console.warn(`[moltbook] Post API failed: ${err.message}`);
    }

    console.log(`[moltbook] Scraping post page: ${postUrl}`);
    const resp = await fetchWithTimeout(postUrl);
    if (!resp.ok) {
      return { post: null, karma: 0, handle: null, source: "unavailable", error: `HTTP ${resp.status}` };
    }

    const html = await resp.text();
    const $ = cheerio.load(html);

    const title = $("h1, .post-title, [data-testid='post-title'], article h2").first().text().trim() || "Moltbook Post";
    const likes = parseInt($('.likes, .upvotes, [data-likes], [data-testid="like-count"]').first().text().replace(/[^0-9]/g, ""), 10) || 0;
    const comments = parseInt($('.comments, .replies, [data-comments], [data-testid="comment-count"]').first().text().replace(/[^0-9]/g, ""), 10) || 0;
    const shares = parseInt($('.shares, .reposts, [data-shares]').first().text().replace(/[^0-9]/g, ""), 10) || 0;
    const authorHandle = $('[data-testid="author-handle"], .author-handle, .username').first().text().replace("@", "").trim() || null;
    const authorKarma = parseInt($('[data-testid="author-karma"], .author-karma').first().text().replace(/[^0-9]/g, ""), 10) || 0;

    if (title !== "Moltbook Post" || likes > 0 || comments > 0) {
      return {
        post: {
          id: postUrl.split("/").pop() || "unknown",
          title: title.substring(0, 100),
          url: postUrl,
          likes,
          comments,
          shares,
          submolt: $(".submolt, .community").first().text().trim() || "general",
          postedAt: $("time").first().attr("datetime") || new Date().toISOString(),
        },
        karma: authorKarma,
        handle: authorHandle,
        source: "scrape",
      };
    }

    return { post: null, karma: 0, handle: null, source: "unavailable", error: "No parseable post data found" };
  } catch (err: any) {
    return { post: null, karma: 0, handle: null, source: "unavailable", error: err.message };
  }
}

export function getMoltbookRateLimitStatus(): {
  remaining: number;
  resetInMs: number;
  cacheSize: number;
} {
  const now = Date.now();
  const elapsed = now - rateLimitState.windowStart;
  const remaining = elapsed > RATE_LIMIT_WINDOW_MS
    ? RATE_LIMIT_MAX_REQUESTS
    : Math.max(0, RATE_LIMIT_MAX_REQUESTS - rateLimitState.count);
  const resetInMs = Math.max(0, RATE_LIMIT_WINDOW_MS - elapsed);

  return {
    remaining,
    resetInMs,
    cacheSize: moltbookCache.size,
  };
}
