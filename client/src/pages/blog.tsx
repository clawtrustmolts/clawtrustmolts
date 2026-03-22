import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Calendar, Clock, Tag, ArrowRight, BookOpen } from "lucide-react";
import { SkeletonCard, ErrorState } from "@/components/ui-shared";
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

function FeaturedCard({ post }: { post: BlogPost }) {
  return (
    <Link href={`/blog/${post.slug}`}>
      <div
        className="relative rounded-sm overflow-hidden cursor-pointer group transition-all duration-200"
        style={{ border: "1px solid rgba(232,84,10,0.25)", background: "var(--ocean-mid)" }}
        data-testid={`card-featured-post-${post.slug}`}
      >
        {post.coverImage && (
          <div className="relative w-full overflow-hidden" style={{ height: "240px" }}>
            <img
              src={post.coverImage}
              alt={post.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              data-testid={`img-featured-cover-${post.slug}`}
            />
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to bottom, transparent 30%, var(--ocean-mid) 100%)" }}
            />
          </div>
        )}
        {!post.coverImage && (
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{ background: "linear-gradient(135deg, rgba(232,84,10,0.06), transparent)" }}
          />
        )}
        <div className="p-6 sm:p-8 relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="px-2 py-0.5 rounded-sm text-[10px] font-display uppercase tracking-widest"
              style={{ background: "rgba(232,84,10,0.2)", color: "var(--claw-orange)" }}
            >
              Featured
            </span>
          </div>

          <h2
            className="font-display text-2xl sm:text-3xl tracking-wide mb-3 group-hover:text-[var(--claw-orange)] transition-colors"
            style={{ color: "var(--shell-white)", lineHeight: 1.25 }}
            data-testid="text-featured-title"
          >
            {post.title}
          </h2>

          <p
            className="text-sm leading-relaxed mb-5"
            style={{ color: "var(--text-muted)", maxWidth: "65ch" }}
          >
            {post.excerpt}
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-5">
            {(post.tags || []).slice(0, 4).map(tag => (
              <TagPill key={tag} tag={tag} />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(post.publishedAt)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {post.readMinutes} min read
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5" />
                {post.author}
              </span>
            </div>

            <span
              className="flex items-center gap-1.5 text-[11px] font-display uppercase tracking-widest group-hover:gap-2.5 transition-all"
              style={{ color: "var(--claw-orange)" }}
            >
              Read <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link href={`/blog/${post.slug}`}>
      <div
        className="rounded-sm overflow-hidden cursor-pointer group transition-all duration-200 flex flex-col h-full"
        style={{ border: "1px solid rgba(200,57,26,0.2)", background: "var(--ocean-mid)" }}
        data-testid={`card-post-${post.slug}`}
      >
        {post.coverImage && (
          <div className="w-full overflow-hidden" style={{ height: "140px" }}>
            <img
              src={post.coverImage}
              alt={post.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              data-testid={`img-post-cover-${post.slug}`}
            />
          </div>
        )}
        <div className="p-5 flex flex-col flex-1 relative">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(post.tags || []).slice(0, 3).map(tag => (
              <TagPill key={tag} tag={tag} />
            ))}
          </div>

          <h3
            className="font-display text-base tracking-wide mb-2 group-hover:text-[var(--claw-orange)] transition-colors flex-1"
            style={{ color: "var(--shell-white)", lineHeight: 1.35 }}
            data-testid={`text-post-title-${post.slug}`}
          >
            {post.title}
          </h3>

          <p
            className="text-[12px] leading-relaxed mb-4"
            style={{ color: "var(--text-muted)" }}
          >
            {post.excerpt.length > 130 ? post.excerpt.slice(0, 130) + "…" : post.excerpt}
          </p>

          <div className="flex items-center justify-between mt-auto pt-3" style={{ borderTop: "1px solid rgba(200,57,26,0.12)" }}>
            <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(post.publishedAt)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {post.readMinutes}m
              </span>
            </div>

            <ArrowRight
              className="w-4 h-4 group-hover:translate-x-0.5 transition-transform"
              style={{ color: "var(--claw-orange)" }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function BlogPage() {
  const { data: posts = [], isLoading, isError } = useQuery<BlogPost[]>({
    queryKey: ["/api/blog"],
  });

  const featured = posts[0] ?? null;
  const rest = posts.slice(1);

  return (
    <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="mb-10">
          <p className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--claw-orange)" }}>
            Community
          </p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-[2px] mb-3" style={{ color: "var(--shell-white)" }}>
            CLAWTRUST BLOG
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Protocol updates, deep dives, and insights from the agent economy.
          </p>
        </div>

        {isLoading && (
          <div className="space-y-6">
            <SkeletonCard />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        )}

        {isError && (
          <ErrorState message="Failed to load blog posts. Please try again." />
        )}

        {!isLoading && !isError && posts.length === 0 && (
          <div
            className="rounded-sm p-12 text-center"
            style={{ border: "1px solid rgba(200,57,26,0.15)", background: "var(--ocean-mid)" }}
            data-testid="text-no-posts"
          >
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: "var(--claw-orange)" }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No posts yet. Check back soon.</p>
          </div>
        )}

        {!isLoading && !isError && featured && (
          <div className="space-y-8">
            <FeaturedCard post={featured} />

            {rest.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <h2
                    className="font-display text-xs uppercase tracking-[2px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    More Articles
                  </h2>
                  <div className="flex-1 h-px" style={{ background: "rgba(200,57,26,0.15)" }} />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {rest.map(post => (
                    <div key={post.slug} className="relative">
                      <PostCard post={post} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
