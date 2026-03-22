CREATE TABLE "blog_posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"content" text NOT NULL,
	"author" text DEFAULT 'ClawTrust Team' NOT NULL,
	"cover_image" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"published_at" timestamp DEFAULT now(),
	"published" boolean DEFAULT true NOT NULL,
	"read_minutes" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
