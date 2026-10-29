# Configuration and deployment

This branch requires a coordinated database/app release. The live production URL is https://ai-document-black.vercel.app/; configuration described here is not evidence that a release has happened.

## Local stack

Install Node 24.22.1, Docker and Supabase CLI 2.122.0. Run `npm ci` then `supabase start`. The committed `supabase/config.toml` is for disposable local development, with relaxed **local Auth test quotas**, email confirmation enabled and Mailpit on port 54324. Do not copy its quotas to production.

Copy `.env.example` into `.env.local`. Set public URL/anon key and server service-role key from `supabase status`. Generate independent `CSRF_SECRET` and `RATE_LIMIT_SECRET`, each at least 32 random bytes (`openssl rand -hex 32`). Keep all three server secrets out of client props, `NEXT_PUBLIC_` variables, build artifacts and logs. Node/Next reads `.env.local`; shell-driven integration tests need explicitly exported local variables.

Development uses `APP_ORIGIN=http://localhost:3000`. Production-mode browser tests use `https://localhost:3000`. The application rejects plain HTTP in production. The test proxy creates a short-lived local certificate and overwrites `x-real-ip`; it is not a deployment server. Direct local development needs an ingress that overwrites a trusted IP header for authentication and temporary-session entry. The tests supply that ingress automatically. Do not trust a client-supplied IP header on a public listener.

## Production environment

Configure in the hosting provider's encrypted environment settings:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | Exact HTTPS canonical application origin, with no path/query; the live deployment uses `https://ai-document-black.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase project HTTPS URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anonymous key; RLS remains required |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service key; narrowly scoped server RPC use |
| `CSRF_SECRET`, `RATE_LIMIT_SECRET` | Independent random secrets of at least 32 bytes |
| `TRUSTED_CLIENT_IP_HEADER` | `x-vercel-forwarded-for` only when the actual Vercel ingress overwrites it and direct origin access is blocked; otherwise configure and verify another supported trusted ingress |

Supported trusted IP headers are `cf-connecting-ip`, `x-vercel-forwarded-for`, and `x-real-ip`. The server accepts a single validated IP, never an arbitrary forwarded list. Confirm the production ingress behavior with a controlled spoofing test before release. Do not add test database URLs or CI credentials to production.

Use separate Supabase projects and exact application origins for staging and production. Preview deployments must never reuse a production service key or database. Build with the public URL/key for the target environment; Next embeds public variables at build time. Disable production deployment of intermediate feature commits.

## Supabase Auth

1. Enable email/password signups and email confirmation. Require at least 12-character passwords. Configure a verified SMTP sender, delivery monitoring, anti-abuse quotas and provider protections. Test resend and password reset with actual mailboxes.
2. Set Site URL to the canonical `APP_ORIGIN`. Allow the exact `${APP_ORIGIN}/auth/callback` redirect. Do not allow wildcard production hosts or arbitrary user redirects.
3. Install the committed confirmation and recovery templates from `supabase/templates/`. Confirmation uses a token-hash link to `/auth/confirm` and a URL-encoded `.RedirectTo`; recovery uses the same server endpoint with `type=recovery`. Retain the `.RedirectTo | urlquery` expression exactly.
4. Enable Google's provider in Supabase. In Google Cloud create an OAuth web client, configure the consent screen/audience and register the **Supabase project's provider callback**, as shown in Supabase's Google configuration. Store the Google client ID and secret in Supabase; never in this repo. Supabase redirects to the app's allowlisted `/auth/callback` using PKCE.
5. Verify Google login, existing-account login, email confirmation in another tab, spent links, reset and logout on staging. A real Google provider flow is a manual release gate; unit mocks do not prove the provider configuration.
6. Review production session lifetime, refresh-token rotation, abuse protection and SMTP quotas. Revocation/ban/verification changes are checked against current database state for document access. Do not treat an old self-contained JWT as indefinitely revocable without checking the provider's token lifetime semantics.

## Database and scheduling

Use the ordered migrations in `supabase/migrations/` through 0010. The archive migration moves legacy tables, preserves their relationships and revokes all application roles. New personal documents use Auth UUID ownership and RLS; temporary tables are in `temporary_private`, not in the Data API schema list. Keep `legacy_archive`, `temporary_private`, `persistent_security`, and `request_security` out of exposed API schemas.

Enable `pg_cron` with UTC/GMT scheduler timezone and execution logging. Named jobs purge expired temporary workspaces every minute, reset demos at `0 16 * * *` UTC (midnight PHT), purge expired claim receipts every minute, and retain rate-limit records according to their scheduled policy. Deadlines are enforced in database operations and deferred commit guards independently of cron. Alert on failed `cron.job_run_details`, more than two minutes of cleanup lag and failed maintenance runs. Restrict log access: avoid logging cookie hashes, email links, document HTML or service credentials.

Monitor safe aggregate error rates, 429s, RPC latency, import timeouts, cleanup lag and Auth delivery. Configure infrastructure/WAF quotas and alerts as appropriate. Application rate limiting uses a shared database and fails closed on storage errors.

See [cutover](cutover.md) for backup, migration, recovery and release order.

## Read-only readiness commands

After migrations, export the target administrator `DATABASE_URL` privately and run `node scripts/check-deployment.ts` (or `node --env-file=.env.local scripts/check-deployment.ts --local` for the disposable stack). It validates required environment names without printing values, migration0010, RLS/column grants, private schema/RPC restrictions, deferred guards, named cron jobs and their latest failure status. It never applies migrations or changes data. A freshly registered cron job with no successful run still requires observation; a checker pass does not prove SMTP/Google/callback configuration, ingress behavior, API schema exposure or backup restoration.

Before migrating, `node scripts/check-migration.ts --preflight` requires `DATABASE_URL` and `BACKUP_RESTORE_REHEARSAL_ID`, rejects unknown schemas and makes only read-only queries. The reference is an operator acknowledgement of the backup rehearsal, not automated backup verification. Inspect all existing SECURITY DEFINER functions and dependent database objects before archiving legacy data; do not leave any RPC that exposes archived rows.
