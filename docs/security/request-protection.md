# Request protection deployment contract

Deploy the authentication, repository, route, and database changes as one coordinated release. These helpers alone do not protect routes that have not been migrated to them.

## Configuration

- `APP_ORIGIN`: the exact externally visible application origin, such as `https://docs.example.com`. It must have no credentials, path, query, or fragment. HTTPS is mandatory in production. Local development accepts HTTP only for localhost/loopback addresses, including the configured port. This value never comes from an incoming `Host`, `Forwarded`, or `X-Forwarded-Host` header.
- `CSRF_SECRET`: independently generated server-only random secret, at least 32 bytes. Rotating it invalidates issued CSRF tokens and preauthentication cookies. Never prefix it with `NEXT_PUBLIC_`.
- `RATE_LIMIT_SECRET`: independently generated server-only random secret, at least 32 bytes. HMAC-hashes identifiers before they reach limiter storage. Rotation starts fresh identifier buckets; coordinate rotation with abuse monitoring.
- `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY`: required for durable request limits. Missing credentials, malformed RPC responses, and database failures deny work with a generic 503. There is no memory or JSON fallback.
- `TRUSTED_CLIENT_IP_HEADER`: explicitly choose `cf-connecting-ip`, `x-vercel-forwarded-for`, or `x-real-ip` only after verifying the deployment contract below. Missing, unsupported, malformed, or multi-address values fail closed. Generic `X-Forwarded-For` is never a fallback.

The edge proxy **must overwrite** the selected client-IP header using the actual connected visitor's address, strip user-supplied copies, and prevent visitors from reaching the application origin directly. Merely selecting a header name does not authenticate its contents. Verify this with the actual hosting provider and edge configuration before enabling public session/authentication endpoints. For a custom reverse proxy, use `x-real-ip` only when these conditions hold. IPv6 text is canonicalized before hashing.

## Route composition

For cookie-authenticated mutations, first resolve a validated session, check canonical `Origin` and `X-CSRF-Token` with `requireCsrf`, consume the appropriate durable limiter bucket, and only then parse the bounded body or perform expensive work. Browser mutation requests missing `Origin` are rejected. Cross-site Fetch Metadata is rejected even if an Origin header otherwise matches. API GET handlers must never mutate document or authentication state.

CSRF bindings include a validated real authentication session identity, temporary credential/session identity, or the signed preauthentication cookie; a user UUID alone is insufficient. The entry bootstrap uses `createPreAuthSession()` to issue a fifteen-minute signed random HttpOnly, SameSite=Strict cookie and no-store JSON `{csrfToken}`. HTTPS deployments use a Secure `__Host-` cookie with Path=/ and no Domain. Call `getPreAuthBinding(request)` for unauthenticated forms. Rotate/remove the preauthentication cookie on login and mode transition. It grants no document access. CSRF tokens are signed, session-bound, and expire after fifteen minutes without sliding. The bootstrap must not be cached.

Use `hashLimitKey` with distinct scopes and server-validated identifiers. Session creation consumes `session` by trusted IP. Auth consumes `auth` by trusted IP **before parsing** and again by normalized email after bounded schema validation. Document mutation, upload, and presence keys come from validated session/user identity, never browser-supplied owner, persona, user ID, or forwarding metadata. Never use OAuth callback codes or verification tokens as limiter identifiers or log values.

| Bucket | Limit | Window |
| --- | --- | --- |
| session | 20 | 1 hour |
| auth | 10 | 15 minutes |
| mutation | 120 | 1 minute |
| upload | 10 | 10 minutes |
| presence | 120 | 1 minute |

Buckets use database time and fixed windows. Denial returns the seconds until the current window ends; `requireLimit` maps this to the standard 429 error and `Retry-After`. Presence has a separate budget from document mutations. Limits are atomic across application instances; SQL accepts no caller-specified capacity, interval, or timestamp.

`parseJsonBody` checks Content-Length before reading and independently counts actual stream bytes. It cancels the stream at the cap and rejects unsupported content types, encoding, invalid UTF-8, malformed JSON, and schema errors. The default JSON cap is 64 KiB. Document routes explicitly use `DOCUMENT_REQUEST_BYTES`, allowing JSON escapes while the HTML itself remains capped at 1 MiB before and after server sanitization. Strict schemas reject unknown identity fields; sharing accepts email or demo persona, then resolves recipients on the server.

## Database and verification

Apply `202610270004_request_limits.sql` with administrator privileges. It creates private RLS-enabled tables, a SECURITY DEFINER RPC executable only by `service_role`, and a `pg_cron` job running every minute. No browser or service role gets direct table access. Rows are purged once their window is more than 24 hours past expiry, with request-time cleanup as a backstop. Verify `ai-docs-request-limit-retention` exists in `cron.job` and monitor its run history. Failure to install `pg_cron` is a release blocker.

Run unit verification with `npm run test:unit -- tests/unit/request-security.test.ts`. Run real database verification with `RUN_RATE_LIMIT_DB_TESTS=1 npm run test:integration -- tests/integration/rate-limit.test.ts` against an isolated local Supabase instance and installed `psql`. `RATE_LIMIT_TEST_DATABASE_URL` may select only localhost/loopback port 54322, database `postgres`, with no query/fragment overrides. Never point this suite at production.

The implementation session passed 36 focused unit tests and the full 113-test unit suite. Real database tests were attempted but could not execute because `psql` is unavailable and Docker is unavailable in that environment. CI must execute the six database tests, covering independent concurrent connections, expiry recovery, retention, bucket budgets, grants, and invalid arguments, before release.
