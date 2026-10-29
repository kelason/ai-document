# Isolated test environment

No test in this suite is authorized to target production. Helpers reject non-loopback Supabase/SQL/mail URLs, and SQL fixtures only allow port 54322/database `postgres` without URI query overrides. Start Docker, install Supabase CLI 2.122.0 and run `supabase start`.

Export local values from `supabase status` into the shell without printing private keys:

- `SUPABASE_TEST_URL`, `NEXT_PUBLIC_SUPABASE_URL`: local API URL (normally `http://127.0.0.1:54321`).
- `SUPABASE_TEST_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: local anon key.
- `SUPABASE_TEST_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: local service key.
- `SUPABASE_TEST_INBOX_URL=http://127.0.0.1:54324`.
- `APP_ORIGIN=https://localhost:3000` and `TRUSTED_CLIENT_IP_HEADER=x-real-ip`.
- Independent random `CSRF_SECRET` and `RATE_LIMIT_SECRET` of at least 32 bytes.
- `RUN_MIGRATION_DB_TESTS=1`, `RUN_RATE_LIMIT_DB_TESTS=1`.
- `RATE_LIMIT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `MIGRATION_TEST_DATABASE_URL` set to the same disposable local URL.

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:all
```

`test:all` runs lint, type checking, Vitest unit tests, local DB reset + pgTAP SQL tests, real Auth/PostgREST integration tests, production build and browser tests. Missing local credentials/database produce an explicit failure; do not count setup failures as passing security tests. The opt-in SQL migration/rate tests require the two `RUN_*` variables above. CI enables both.

`npm run test:e2e` launches `.next/standalone/server.js` and a loopback-only HTTPS proxy. No development server or live site is used. Its ephemeral self-signed test certificate is accepted only in the test browser. The proxy strips forwarded IP headers and assigns each test context a separate IP for shared limiter isolation. This code never runs in the production app.

Browser suites cover public choices, create/edit/reload, real email signup and confirmation, explicit guest transfer, login, permissions, expiry, midnight generation reset, cross-workspace denial, safe/unsafe imports in the packaged worker, missing-document recovery, CSP and session end. Google boundary/unit tests cover server initiation, PKCE callback handling and safe redirect destinations. Real Google consent/login requires staging credentials and manual verification.

Traces, video and screenshots are disabled for account tests; the custom reporter redacts common token parameters. CI masks generated local keys and does not upload database dumps, mailboxes, session state or document screenshots. Inspect logs privately before sharing if a test fails in a new way.

The GitHub workflow repeats SQL, integration and browser tests after another empty local reset. A green unit run or an embedded Postgres harness is not a substitute for this gate. On a constrained desktop where Chromium or Docker cannot run, use the isolated CI result and record the limitation.
