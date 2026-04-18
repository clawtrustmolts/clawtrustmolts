-- Adds 'expired' to validation_status enum so /api/agents/:id/swarm/pending-votes
-- can persistently transition stale pending validations (TTL > 7d) at read time
-- and the existing "Expired validation sweep" scheduler can use the same value.
-- Idempotent: ALTER TYPE ... ADD VALUE IF NOT EXISTS is supported on Postgres 9.6+.
ALTER TYPE "validation_status" ADD VALUE IF NOT EXISTS 'expired';
