-- Private durable limiter state. Only the restricted SECURITY DEFINER entrypoint
-- is exposed to the server's service role; browser roles cannot consume budgets.
CREATE SCHEMA IF NOT EXISTS request_security;
REVOKE ALL ON SCHEMA request_security FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS request_security.rate_limits (
  key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  bucket text NOT NULL CHECK (bucket IN ('session', 'auth', 'mutation', 'upload', 'presence')),
  used integer NOT NULL CHECK (used > 0),
  window_ends_at timestamptz NOT NULL,
  PRIMARY KEY (bucket, key_hash)
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON request_security.rate_limits(window_ends_at);
ALTER TABLE request_security.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE request_security.rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_request_limit(p_key_hash text, p_bucket text)
RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer;
  v_window interval;
  v_used integer;
  v_ends_at timestamptz;
  v_now timestamptz;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid request limit key' USING ERRCODE = '22023';
  END IF;
  CASE p_bucket
    WHEN 'session' THEN v_limit := 20; v_window := interval '1 hour';
    WHEN 'auth' THEN v_limit := 10; v_window := interval '15 minutes';
    WHEN 'mutation' THEN v_limit := 120; v_window := interval '1 minute';
    WHEN 'upload' THEN v_limit := 10; v_window := interval '10 minutes';
    WHEN 'presence' THEN v_limit := 120; v_window := interval '1 minute';
    ELSE RAISE EXCEPTION 'Invalid request limit bucket' USING ERRCODE = '22023';
  END CASE;

  -- Request-time backstop in addition to the cron job. Never keeps expired
  -- keys alive by sliding expiry on denied attempts. A stable statement cutoff
  -- allows an expiry-index range rather than evaluating a volatile clock per row.
  DELETE FROM request_security.rate_limits
    WHERE window_ends_at < pg_catalog.statement_timestamp() - interval '24 hours';

  -- Serialize by bucket/key, including the previously-absent-row case. Capture
  -- the database clock AFTER acquiring the lock so queued requests use current
  -- windows. No caller-provided time, capacity, or retention values are accepted.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bucket || ':' || p_key_hash, 0));
  v_now := pg_catalog.clock_timestamp();
  INSERT INTO request_security.rate_limits AS buckets (key_hash, bucket, used, window_ends_at)
    VALUES (p_key_hash, p_bucket, 1, v_now + v_window)
  ON CONFLICT (bucket, key_hash) DO UPDATE SET
    used = CASE WHEN buckets.window_ends_at <= v_now THEN 1 ELSE LEAST(buckets.used + 1, v_limit + 1) END,
    window_ends_at = CASE WHEN buckets.window_ends_at <= v_now THEN v_now + v_window ELSE buckets.window_ends_at END
  RETURNING buckets.used, buckets.window_ends_at INTO v_used, v_ends_at;
  RETURN QUERY SELECT v_used <= v_limit,
    CASE WHEN v_used <= v_limit THEN 0 ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_ends_at - v_now)))::integer) END;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_request_limit(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_request_limit(text, text) TO service_role;

-- Supabase supports pg_cron. This is a release prerequisite: unsupported local
-- PostgreSQL must not silently omit automatic retention.
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $schedule$
BEGIN
  PERFORM cron.schedule(
    'ai-docs-request-limit-retention',
    '* * * * *',
    $command$DELETE FROM request_security.rate_limits WHERE window_ends_at < statement_timestamp() - interval '24 hours'$command$
  );
END;
$schedule$;
