# AI Docs Authentication and Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver AI Docs with verified real accounts, isolated public demos, expiring guests, enforced permissions, and automated security regression coverage.

**Architecture:** Keep the Next.js editor and Supabase database. Real users use Supabase Auth and user-scoped RLS; guest/demo workspaces use opaque cookies and separate private tables accessed only through restricted server functions. Database transactions enforce expiry, reset generations, permissions, and transfer atomicity.

**Tech Stack:** Next.js 16.3.3, React 19, TypeScript, Supabase Auth/Postgres/Cron, `@supabase/ssr`, Zod, `sanitize-html`, a bounded ZIP reader for DOCX inspection, Vitest, Playwright, and GitHub Actions. Use Node 24 LTS; resolve compatible dependency versions during implementation and commit the lockfile rather than using floating runtime installs.

**Spec:** `docs/superpowers/specs/2026-10-27-ai-docs-auth-security-design.md`, approved by the user on 2026-10-27.

## Global Constraints

- Rename Antigravity Docs to AI Docs across interface, metadata, templates, and documentation; retain the merged missing-document fix.
- Google sign-in and display-name/email/password registration; email/password users must verify before persistent access.
- Alice, Bob, and Charlie are public no-login demo personas, isolated per visitor; never real shared-password accounts.
- Guest expiry is five hours after session creation, never sliding. Demo data resets every midnight Philippine time (Asia/Manila, UTC+8), not after a rolling 24 hours.
- Expired data becomes inaccessible at the boundary even when cleanup is delayed. Cleanup runs every minute; demo reset schedule is 16:00 UTC daily.
- Demo session records expire after 24 hours without activity. Real-account data never participates in temporary cleanup.
- Initial limits: 20 documents per temporary workspace, 1 MiB HTML per document, 5 MiB uploaded input, 50 history revisions per document.
- Preserve legacy data in a private administrator-only archive. Never infer real ownership from a demo name or first signup.
- Exact-email sharing only to existing verified accounts; demo sharing stays within its workspace; guests cannot share.
- Do not use the word “employer” in README copy. Public access instructions contain no passwords, secrets, or privileged endpoints.
- No production JSON/memory persistence fallback; no production database credentials in CI; no destructive production security testing.
- All migrations and app changes form a coordinated release. Intermediate commits may pass isolated tests but must not be deployed independently.

## Review Focus

1. A save started before midnight but committed after reset must not resurrect old demo content — database and UI tests in Tasks 7 and 11.
2. Two tabs transferring the same guest data while cleanup runs must produce one complete transfer or a clean expiry — Task 10.
3. A revoked share or stale/unverified auth token must not retain access through direct API/database calls — Tasks 3, 5, and 9.
4. A pasted/imported rich-text table must retain supported formatting while active HTML, dangerous URLs, and compressed-file bombs are rejected — Tasks 8 and 11.
5. OAuth/email callbacks opened in another tab or after guest expiry must authenticate safely without claiming expired data or redirecting off-site — Tasks 5, 10, and 12.

## Execution boundaries and file map

Start execution from the approved design branch, rebased onto current main if necessary. Inspect `AGENTS.md`, read installed Next.js guides, and use the worktree skill at execution time. Do not reuse partially installed dependencies from the previous bugfix session. Local npm previously encountered certificate and cache problems: use a writable cache and trusted certificate configuration; never disable TLS verification. Stop environment retries after diagnosing the blocker and use CI/staging for supported verification instead of making product changes to bypass it.

The subsystems below share identity and database contracts, so this plan keeps them together. Follow the task dependencies; do not release branding/auth before the security boundary is ready.

| Area | Files and responsibility |
| --- | --- |
| Shared contracts | `lib/auth/types.ts`, `lib/documents/types.ts`, `lib/http/errors.ts`: actor, document DTOs, typed API errors |
| Real identity | `lib/supabase/{server,browser,admin}.ts`, `lib/auth/{context,return-path}.ts`, `proxy.ts`, `app/auth/*`: verified SSR authentication |
| Temporary identity | `lib/temporary/{sessions,expiry,repository}.ts`, `app/api/session/*`: cookie sessions, persona changes, temporary DB adapter |
| Persistent access | `lib/documents/{repository,permissions}.ts`, `lib/sharing/recipients.ts`: user-scoped queries and allowed operations |
| Input protection | `lib/security/{csrf,rate-limit,html,validation}.ts`, `lib/import/{parse,docx}.ts`: validation, quotas, sanitization, bounded imports |
| Database | `supabase/config.toml`, `supabase/migrations/*.sql`, `supabase/tests/*.test.sql`: schema, RLS, private RPCs, reset/cleanup/claim |
| UI | Existing pages/editor/share/upload components; new `components/auth/*`, `components/temporary/*`: entry, account flows, expiry/reset UX |
| Test harness | `vitest.config.ts`, `tests/{unit,integration,e2e,helpers}/`, `playwright.config.ts`: isolated test layers |
| Operations | `scripts/`, `docs/{security,deployment}/`, `.github/workflows/`, `.env.example`, `README.md`: migration, scans, CI, rollout |

Use numbered timestamps below as migration filenames; never rewrite an already applied migration. `lib/db.ts` becomes a short migration facade and is removed once all consumers use the new repositories. Do not rewrite unrelated editor internals.

## Common contracts

Task 1 creates these interfaces; later tasks import them rather than inventing parallel types:

```ts
type DemoPersona = 'alice' | 'bob' | 'charlie';
type Actor =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; workspaceId: string; sessionId: string; generation: number; expiresAt: string }
  | { kind: 'demo'; workspaceId: string; sessionId: string; generation: number; expiresAt: string; persona: DemoPersona };
type Operation = 'read' | 'edit' | 'upload' | 'restore' | 'delete' | 'manage-shares' | 'presence';
type ErrorCode = 'UNAUTHENTICATED' | 'VERIFICATION_REQUIRED' | 'NOT_FOUND' |
  'FORBIDDEN' | 'SESSION_EXPIRED' | 'DEMO_RESET' | 'VALIDATION_ERROR' |
  'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'STORAGE_UNAVAILABLE';
```

`RequestContext = { actor: Actor; store: DocumentStore }` is server-only and never serializes cookies, token hashes, or service credentials. `DocumentStore` exposes `list()`, `get(id)`, `create(input)`, `update(id,input)`, `remove(id)`, `restore(id,versionId)`, `listShares(id)`, `grantShare(id,recipient,permission)`, `revokeShare(id,shareId)`, `addAttachment(id,input)`, and `heartbeat(id,input)`, all asynchronous and typed with explicit DTOs. Writes accept no owner/user ID from the browser. A temporary store is constructed with its validated credential and expected generation, not just the display actor.

Define `DocumentSummary` with id/title/createdAt/updatedAt/owner display metadata/permissions, and `DocumentDetail` adding sanitized content, history, shares and attachment metadata. Repository return types are `Promise<DocumentSummary[]>` for list; `Promise<DocumentDetail>` for get/create/update/restore; `Promise<void>` for remove/revokeShare; `Promise<Share[]>` for listShares; `Promise<Share>` for grantShare; `Promise<Attachment>` for addAttachment; and `Promise<Presence[]>` for heartbeat. Missing/denied records throw the standard ApiError. Create input is `{title:string;content:string}`; update is `{title?:string;content?:string;createVersion?:boolean}`; recipient is `{userId:string}` or `{persona:DemoPersona}`, resolved server-side after context selection. Attachment input contains filename/MIME/size/placeholder URL, never HTML. Presence input contains only active and bounded cursor coordinates; the store supplies identity.

Standard HTTP mapping: unauthenticated 401; unverified/forbidden 403; inaccessible document 404; expired session 410; reset generation 409; invalid input 400; upload too large 413; quota/rate exceeded 429 with Retry-After for rate limits; storage unavailable 503. Return `{error, code}` without internal details. Expected temporary generation travels in `X-Workspace-Generation` and is verified in SQL, never treated as proof of access.

## Task 1: Establish executable contracts and the unit test harness

**Files:** Create `lib/auth/types.ts`, `lib/documents/types.ts`, `lib/documents/permissions.ts`, `lib/http/errors.ts`, `vitest.config.ts`, `tests/unit/permissions.test.ts`; modify `package.json`, `package-lock.json`, `playwright.config.ts`.

**Interfaces:** Produce the contracts above and `canPerform(role: 'owner'|'editor'|'viewer', operation: Operation): boolean`. Declare DTOs for history, attachments, presence, shares, and document summaries/detail, keeping existing editor fields where possible. Browser DTOs include permissions and session expiry metadata, not credentials.

- [ ] Write the role matrix test, including `expect(canPerform('viewer','edit')).toBe(false)` and `expect(canPerform('editor','manage-shares')).toBe(false)`; owners allow all operations, editors allow read/edit/upload/restore/presence, viewers allow read/presence.
- [ ] Add Vitest with separate unit/integration projects; add `test:unit`, `test:integration`, and `typecheck` scripts. Point existing Playwright discovery at E2E files only. Run `npm run test:unit -- tests/unit/permissions.test.ts`; confirm failure from missing implementation.
- [ ] Implement contracts, permission matrix, and `ApiError(code,message)` plus `toErrorResponse(error): Response`; validate error mappings in a second table-driven test.
- [ ] Run focused unit tests and typecheck; record pre-existing lint/type failures before fixing relevant ones. Do not weaken TypeScript or ESLint globally.
- [ ] Commit `test: establish auth contracts and Vitest harness` after the tests pass.

## Task 2: Create safe migrations and preserve legacy data

**Files:** Create `supabase/config.toml`, `supabase/migrations/202610270001_archive_legacy.sql`, `supabase/migrations/202610270002_persistent_schema.sql`, `supabase/tests/migration.test.sql`, `tests/integration/migration.test.ts`, `scripts/check-migration.ts`; modify `supabase_schema.sql`, `fix_rls.sql`; remove `app/api/migrate/route.ts`.

**Interfaces:** Produce `public.profiles`, `documents`, `document_history`, `document_shares`, `document_attachments`, `document_presence`; archive original tables/records in non-exposed `legacy_archive`. Preserve document IDs in the archive; new persistent documents use generated IDs and owner UUID references. A verified profile flag is server-maintained, never client-writable.

- [ ] Test fresh initialization and upgrade from the repository's legacy schema: `expect(archivedCount).toBe(legacyCount)`; assert content/history/shares preserved, anonymous archive SELECT denied, no legacy ownership guessed, old migration HTTP route unavailable.
- [ ] Start local Supabase and run `supabase test db`; confirm the archive/schema assertions fail before migration.
- [ ] Implement transactional migrations, foreign keys, indexes, cascades, unique share constraints, and role/grant restrictions. Handle already-enabled realtime publication safely. Replace insecure setup SQL with pointers to versioned migrations; no script may disable RLS for routine setup.
- [ ] Run `supabase db reset`, `supabase test db`, and `npm run test:integration -- tests/integration/migration.test.ts` using the upgrade fixture added with this task. Re-run migration tooling to verify repeat execution cannot duplicate or overwrite archived data.
- [ ] Commit `feat: migrate legacy documents into a protected archive`.

## Task 3: Enforce persistent document permissions in Postgres

**Files:** Create `supabase/migrations/202610270003_persistent_policies.sql`, `supabase/tests/authorization.test.sql`, `tests/integration/rls.test.ts`, `tests/helpers/supabase.ts`, `lib/sharing/recipients.ts`.

**Interfaces:** Produce RLS policies and narrow verified-user RPCs for share resolution and document mutations that require history atomicity. `resolveRecipient(email: string): Promise<{userId:string}|null>` works only through an owner-authorized exact-email share flow. No public email enumeration endpoint.

- [ ] Seed verified owner/editor/viewer/unrelated and unverified users. Test every operation/table directly through Supabase: `expect(await viewer.update(doc)).toBeDenied()`; `expect(await unrelated.readHistory(doc)).toBeDenied()`; owner cannot change `owner_id`; a forged profile verification update fails.
- [ ] Run `npm run test:integration -- tests/integration/rls.test.ts` and `supabase test db`; verify missing-policy failures are real rather than connection failures.
- [ ] Implement RLS, protected profile fields and verification synchronization from trusted Auth state. Include child-table policies and self-owned presence checks. Constrain edited columns and referenced document IDs. Avoid recursive share policies with carefully scoped helpers; fix definer search paths and grants.
- [ ] Verify share revocation and user deletion revoke access on the next request even with an old JWT; test direct REST/RPC access, not just repository mocks. Verified status must use trusted current database state for authorization.
- [ ] Commit `security: enforce verified ownership and sharing with RLS`.

## Task 4: Add durable request protection and resource budgets

**Files:** Create `lib/security/csrf.ts`, `lib/security/rate-limit.ts`, `lib/security/validation.ts`, `supabase/migrations/202610270004_request_limits.sql`, `tests/unit/request-security.test.ts`, `tests/integration/rate-limit.test.ts`.

**Interfaces:** Produce `requireSameOrigin(request: Request): void`, session-bound CSRF issue/verify helpers, and `consumeLimit(key: string, bucket: LimitBucket): Promise<{allowed:boolean;retryAfter:number}>`. Token bootstrap returns a no-store CSRF value tied to the authenticated or temporary session, never a general authentication credential.

For unauthenticated signup/login/session-creation forms, bind CSRF to a short-lived random pre-authentication HttpOnly cookie issued by the entry page. Rotate it on login/mode transition; it grants no document access. Define `issueCsrf(binding:string): string` and `verifyCsrf(binding:string,token:string): boolean` using a server secret and constant-time comparison; authenticated bindings include the validated session identity, not just the user UUID.

- [ ] Test rejected cross-site writes, missing/incorrect CSRF tokens, missing Origin on browser mutation endpoints, malformed/oversized JSON, and `expect(await consumeParallel(11,'auth')).toHaveAllowedCount(10)` for a 10-per-15-minute bucket.
- [ ] Run focused unit/integration tests; confirm failure before implementation.
- [ ] Implement atomic Postgres limiter buckets: session creation 20/hour per trusted client-IP hash; auth requests 10/15 minutes per IP hash and email hash; document mutations 120/minute per session/user; uploads 10/10 minutes. Presence has a separate 120/minute bucket. Use trusted deployment forwarding metadata only, keyed HMAC hashes, and purge expired limit records after 24 hours. Apply limits before body parsing or expensive operations; verification callbacks use provider protections rather than exposing token values to limiter logs.
- [ ] Verify concurrent requests cannot exceed bucket limits, expired buckets recover, storage failure denies expensive work, and unsafe requests cannot bypass protections via a forged Host/forwarded header. Record proxy assumptions in deployment docs.
- [ ] Commit `security: add CSRF validation and durable request limits`.

## Task 5: Implement verified real-account authentication

**Files:** Create `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `lib/supabase/admin.ts`, `lib/auth/context.ts`, `lib/auth/return-path.ts`, `proxy.ts`, `app/auth/actions.ts`, `app/auth/callback/route.ts`, `app/auth/confirm/route.ts`, `tests/unit/auth.test.ts`, `tests/integration/auth.test.ts`, `.env.example`.

**Interfaces:** Produce `getVerifiedUser(): Promise<{userId:string}|null>`, `safeReturnPath(value: string|null): string` (default `/`), and server actions `signInWithGoogle`, `signInWithPassword`, `signUp`, `resendVerification`, `requestPasswordReset`, `updatePassword`, `signOut`. Return typed safe errors; signup takes `{displayName,email,password}`. Task 9 completes `requireContext(request): Promise<RequestContext>` after both stores exist.

- [ ] Test `expect(safeReturnPath('//evil.test')).toBe('/')`, encoded/backslash external redirects, replayed/expired confirmation, unverified persistent access, forged cookies, and logout. Use local Auth plus its test inbox for confirmation/password-reset flows; define helpers in `tests/helpers/auth.ts`.
- [ ] Run auth unit/integration tests and capture failing assertions.
- [ ] Add supported SSR integration and request-scoped clients; verify identity server-side, refresh cookies without caching user responses, exchange callback codes, and reject unverified users. Keep service client in `server-only` module. Use uniform signup/reset responses and minimum 12-character passwords; preserve provider behavior for identity linking rather than inventing email-based merging.
- [ ] Run tests including stale JWT after verification revocation, password reset in a second tab, safe callback return, sign-out, and a valid existing session. Record manual Google smoke steps; no live Google credential automation in CI.
- [ ] Commit `feat: add Google and verified email authentication`.

## Task 6: Implement isolated temporary sessions and private storage

**Files:** Create `lib/temporary/sessions.ts`, `lib/temporary/repository.ts`, `supabase/migrations/202610270005_temporary_workspaces.sql`, `app/api/session/route.ts`, `app/api/session/persona/route.ts`, `tests/integration/temporary.test.ts`.

**Interfaces:** Produce `startTemporarySession(kind:'guest'|'demo',persona?:DemoPersona): Promise<Actor>`, `getTemporarySession(): Promise<Actor|null>`, `switchDemoPersona(persona:DemoPersona): Promise<Actor>`, `endTemporarySession(): Promise<void>`, `createTemporaryStore(credential,expectedGeneration): DocumentStore`. Credential is an internal hash type, absent from browser DTOs.

- [ ] Assert guessed IDs/cookies cannot access a workspace, two visitors selecting Alice see different mutable documents, guests cannot switch persona/share, and `expect(await anonymous.rpc('temporary_get',args)).toBeDenied()`.
- [ ] Run temporary integration tests to verify they fail before private functions exist.
- [ ] Create private temporary session/document/history/share/attachment/presence tables and explicit RPCs for every DocumentStore operation. Allow only the service role to execute the public RPC wrappers; wrappers validate token hash, expected generation, workspace and permission inside the transaction. Persistent tables are not reachable through temporary RPCs.
- [ ] Generate 32 random bytes per opaque cookie; SHA-256 hash at rest, Secure/HttpOnly/SameSite=Lax in production, scoped path, explicit expiry, rotation on mode change. Never log credentials. Test DB grants, cascades, no public schema exposure, and limits of 20 documents/1 MiB each/50 history revisions/25 MiB combined live content plus history per workspace, including concurrent writes.
- [ ] Commit `feat: isolate guest and demo workspace sessions`.

## Task 7: Enforce expiry, midnight reset, fixtures, and cleanup

**Files:** Create `lib/temporary/expiry.ts`, `supabase/migrations/202610270006_expiry_and_demo_reset.sql`, `supabase/fixtures/demo.json`, `scripts/build-demo-seed.ts`, `tests/unit/expiry.test.ts`, `tests/integration/expiry-reset.test.ts`.

**Interfaces:** Produce `nextDemoReset(now: Date): Date`, `guestExpiresAt(createdAt: Date): Date`; database functions `ensure_demo_generation(token_hash,expected_generation)`, `purge_expired_workspaces()`, `reset_due_demos()` with restricted grants. SQL time is authoritative; TS functions provide display/test expectations only.

- [ ] Test `expect(guestExpiresAt(new Date('2026-10-27T02:00:00Z')).toISOString()).toBe('2026-10-27T07:00:00.000Z')`; at `2026-10-27T15:59:59Z` next demo reset is `2026-10-27T16:00:00Z`; at exactly that instant next reset is the following day. Cover month/year boundaries.
- [ ] Run unit and DB tests for just-before/at/after expiry, stale generation saves, and duplicate reset requests; observe failure.
- [ ] Implement transaction locks and fresh `clock_timestamp()` checks after lock acquisition, cleanup every minute, and midnight job `0 16 * * *` explicitly in UTC. Restore Alice proposal/Bob meeting notes/Charlie specification plus history and view/edit examples deterministically with generation-specific IDs; preserve selected persona. Revoke old generation access even when cron is stopped. Clean inactive demo sessions after 24 hours without activity.
- [ ] Verify with concurrent SQL connections that a blocked save crossing midnight fails with DEMO_RESET; duplicate seeds create one fixture set; cleanup removes all temporary children but zero persistent/archive rows. Test guest zero-access at five hours and physical deletion on the next cleanup run. Record job failure observability.
- [ ] Commit `feat: enforce guest expiry and daily PHT demo reset`.

## Task 8: Make rich-text and file imports safe

**Files:** Create `lib/security/html.ts`, `lib/import/parse.ts`, `lib/import/docx.ts`, `tests/unit/html.test.ts`, `tests/unit/import.test.ts`, `tests/fixtures/imports/*`; modify `components/Editor.tsx`, `app/api/documents/[id]/upload/route.ts`.

**Interfaces:** Produce `sanitizeDocumentHtml(html:string): string`, `parseImport(file:{name:string;mimeType:string;bytes:Uint8Array}): Promise<string>`. Normal writes/imports/history restoration and legacy reads all use the sanitizer; client sanitization is defense in depth, not the security boundary.

- [ ] Assert `<img src=x onerror=alert(1)>`, SVG/script/event attributes, javascript/data URLs and hostile pasted HTML cannot execute; `expect(sanitizeDocumentHtml('<p><strong>safe</strong></p>')).toBe('<p><strong>safe</strong></p>')`. Include legitimate tables, headings, lists, links, and supported style fixtures.
- [ ] Run unit tests and observe failure against existing unsafe parsing.
- [ ] Define an explicit HTML/tag/attribute/CSS allowlist matching existing editor controls; permit safe http/https/mailto links, deny remote media by default. Escape plain text before wrapping it. Validate file extension plus content/signature, input at 5 MiB, output at 1 MiB, maximum 2,000 ZIP entries/20 MiB expanded DOCX data/100:1 ratio. Stream/count actual expanded bytes, reject encrypted/traversal/external-resource archives, and bound parser execution to 5 seconds in an abortable worker.
- [ ] Verify compressed bombs fail before mammoth conversion, corrupted files return safe errors, titles/filenames are escaped, and supported formatting survives. Ensure paste and BroadcastChannel content cannot bypass safe insertion in the editor. Do not rely on React escaping after assigning innerHTML.
- [ ] Commit `security: sanitize documents and bound file imports`.

## Task 9: Route every document operation through verified access

**Files:** Create `lib/documents/repository.ts`, `tests/integration/document-api.test.ts`; modify `lib/auth/context.ts`, `lib/db.ts`, all existing `app/api/documents/**/route.ts`; remove obsolete JSON fallback paths.

**Interfaces:** Produce `createPersistentStore(userClient): DocumentStore` and `requireContext(request): Promise<RequestContext>`. Resolve the explicitly selected real or temporary mode server-side; an invalid real session must not silently degrade to demo access. Temporary reads can trigger reset and return new session metadata; stale writes return 409 without replay.

- [ ] Exercise list/get/create/update/delete/restore/shares/upload/presence with all actor roles. Assert `expect(await patchAsViewer()).toMatchObject({status:403})`, unauthorized IDs return 404, nested share/document mismatch fails, spoofed owner/updatedBy/userId fields are rejected, and database outage returns 503 without local writes.
- [ ] Run API integration tests; confirm current unauthenticated routes fail the tests.
- [ ] Replace route imports with requireContext and typed stores; validate CSRF/limits/input before mutations. Persist document+history atomically, derive identity on server, sanitize update/restore paths, cap histories, and use DB-backed authorized presence instead of globalThis. Remove public seed-on-list behavior and unmanaged JSON production persistence.
- [ ] Run API and direct RLS tests together. Verify share revoke immediately blocks list/detail/history/presence; viewer cannot create attachments; service-role module never enters client bundle; all account content is private/no-store. Preserve actual missing-document 404 semantics.
- [ ] Commit `security: authorize every document API operation`.

## Task 10: Atomically save guest documents to a verified account

**Files:** Create `app/api/session/claim/route.ts`, `lib/temporary/claim.ts`, `supabase/migrations/202610270007_claim_guest.sql`, `tests/integration/guest-claim.test.ts`.

**Interfaces:** Produce `claimGuestWorkspace(request:Request): Promise<{documentIds:string[]}>`. A restricted DB RPC receives the server-verified user UUID and guest token hash, validates current verification/expiry, locks the workspace, and commits the complete transfer.

- [ ] Test explicit valid claim transfers documents/history with new IDs and real ownership; `expect(await claimExpired()).toMatchObject({status:410})`; demo claim denied; wrong cookie/CSRF denied; duplicate claim returns the same result without duplicate documents.
- [ ] Run integration tests with two connections racing claim versus cleanup; confirm failure before implementation.
- [ ] Implement all-or-nothing copy with a bounded idempotency receipt, sanitize content, drop shares/presence and placeholder attachment URLs, and remove temporary rows only after successful commit. Inform users that original binary files were never stored. Purge claim receipts after 24 hours; never retain source contents in receipts.
- [ ] Verify rollback leaves guest data intact, real identity cannot be forged, and callback in another tab works only when the matching unexpired guest cookie exists. Authentication after expiry succeeds normally but cannot claim data. No automatic transfer on login.
- [ ] Commit `feat: save unexpired guest work to verified accounts`.

## Task 11: Build AI Docs entry, account, and temporary-session UI

**Files:** Create `app/login/page.tsx`, `app/signup/page.tsx`, `app/verify-email/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `components/auth/AccountMenu.tsx`, `components/temporary/SessionBanner.tsx`; modify `app/page.tsx`, `app/layout.tsx`, `app/documents/[id]/page.tsx`, `components/molecules/ShareModal.tsx`, `components/molecules/FileUploadDropzone.tsx`, `lib/constants.ts`, `components/VersionHistory.tsx`.

**Interfaces:** Consume session metadata and permissions from Tasks 5–10. SessionBanner accepts `{kind,expiresAt,generation,onExpired,onClaim}`. Real-user menus have no persona switcher; demo menus select only their own workspace personas. Sharing accepts exact email for real users and scoped persona choices for demos.

- [ ] Add E2E tests for entry choices, verified signup gating, Google button, demo personas, guest banner/claim, expiry, role controls, and missing-document recovery. Assert `await expect(page.getByRole('button',{name:'Try Alice demo'})).toBeVisible()` and expired editor content is absent after focus/reconnect.
- [ ] Run the new tests against the previous UI and record intended failures.
- [ ] Integrate the existing editor without replacing it. Rename brand copy, remove localStorage identity trust and simulated Bob typing, implement clear verification/retry states, and persist only non-sensitive preferences. Warn five minutes before expiry; cancel debounced saves and clear content, history, attachment metadata, timers, and BroadcastChannels on expiry/reset/sign-out/mode change. Namespace channels by session/workspace generation; never use a channel message as authorization.
- [ ] Verify reset discards stale pending writes and reloads fixtures; offline reconnect cannot replay expired content; sign-out clears cached data; keyboard focus, labels, and errors are accessible; real-account refresh restores session. Keep imported formatting, version history, and view/edit sharing operational.
- [ ] Commit `feat: introduce AI Docs login and public demo experience`.

## Task 12: Finish the isolated browser and integration harness

**Files:** Move existing `tests/*.spec.ts` into `tests/e2e/`; create `tests/e2e/{auth,temporary,sharing,imports,security}.spec.ts`, `tests/helpers/{inbox,fixtures,clock}.ts`, `scripts/test-env.ts`; modify `playwright.config.ts`, `supabase/config.toml`, `package.json`.

**Interfaces:** Produce `test:db` (local reset and SQL tests), `test:integration` (real local Supabase), `test:e2e` (built Next app), and `test:all` (all layers). Helpers obtain test mail from the local inbox and arrange timestamps directly in the test database; no test-only public production endpoint or clock override.

- [ ] Cover signup→verification→login, resend/reset expired links, guest claim, persona sharing, midnight reset, cross-workspace access, and original create/edit flows. Assert an unrelated user's API request remains denied even if the UI is manipulated. Mock Google only at the browser provider/code-exchange boundary in dedicated tests, not in RLS tests.
- [ ] Run the full suite; enumerate genuine feature failures separately from harness faults. Update old tests for login rather than deleting them.
- [ ] Make test fixtures independent per run/worker; test helper refuses any Supabase host other than loopback/test container. Set production-mode Next startup and local trusted redirect URLs, use real inbox confirmation links, and enforce log/artifact redaction.
- [ ] Run `npm run test:all` against an empty local database twice. Expected: all suites pass without order dependencies or production credentials; record test counts and manually verify a staging Google sign-in when provider configuration exists.
- [ ] Commit `test: cover auth isolation expiry and editor regressions`.

## Task 13: Complete the OWASP review and defensive configuration

**Files:** Create `docs/security/owasp-review.md`, `docs/security/threat-model.md`, `tests/e2e/headers.spec.ts`, `tests/integration/security.test.ts`; modify `next.config.ts`, `proxy.ts`, applicable routes.

**Interfaces:** Security report rows contain ASVS 5.0 requirement reference, OWASP category, severity, reproducible evidence, affected file, remediation, regression test, and residual deployment requirement. Threat model covers public browser, auth provider, database, cron, service role, CI, and imports.

- [ ] Capture baseline findings for unauthenticated CRUD/sharing/migration, XSS, cookie/CSRF weaknesses, expired sessions, direct RLS bypass, service-role exposure, and production fallback. Add one behavior test for each remediated finding and verify the unsafe baseline fails where reproducible safely.
- [ ] Run dependency/secret/static scans and record exact versions, date, outputs, and known false positives; do not label an unrun control “passed.”
- [ ] Add enforced CSP compatible with Next nonce handling, editor inline styling constraints and Google redirects; block frame embedding, object sources, unsafe script and non-allowlisted connections. Set Referrer-Policy, nosniff, and appropriate Permissions-Policy. Test the actual production build and callback flows, not header text alone.
- [ ] Re-run security regressions/scans; triage all critical/high findings. Fix reachable risks or block release with a documented reason. Keep remaining medium/low work visible; do not claim OWASP certification.
- [ ] Commit `security: close OWASP findings and document verification`.

## Task 14: Make GitHub Actions the release gate

**Files:** Modify `.github/workflows/playwright.yml`; create `.github/workflows/{security,dependency-review}.yml`, `.github/dependabot.yml`; modify `package.json`, `docs/deployment/ci.md`.

**Interfaces:** Required jobs: lint/typecheck, Vitest unit, Supabase SQL/integration, production build plus Playwright, and security scans. Default permissions `contents: read`; elevate only scanner-specific permissions. Pin actions by verified commit SHA and select an exact Node 24 patch in `.nvmrc` at implementation time.

- [ ] Reproduce each proposed CI command in an isolated checkout; confirm a known failing unit, RLS denial regression, and failing E2E each produce a nonzero status before restoring fixtures.
- [ ] Implement lockfile installs, supported Supabase CLI/container setup, generated local-only keys, Chromium-only installation, production-mode E2E startup, and failure trace/report uploads. No production secrets, pull_request_target execution, or untrusted privileged scripts.
- [ ] Add dependency review for PRs, CodeQL where supported, Gitleaks, and dependency audit with explicit triage policy; scans must fail on newly introduced critical/high actionable findings. Configure fork-safe operation and redact sensitive artifact content.
- [ ] Open/update the implementation PR and verify every required job on its exact head SHA; inspect logs and test counts, not only check names. Document any repository-admin steps needed to require checks on main.
- [ ] Commit `ci: gate changes on unit browser database and security tests`.

## Task 15: Publish documentation and verify the deployment path

**Files:** Modify `README.md`, `.env.example`; create `docs/deployment/{setup,cutover,rollback,operations}.md`, `scripts/check-deployment.ts`, `tests/integration/deployment.test.ts`.

**Interfaces:** `check-deployment` is read-only by default: verifies required env names without printing values, database migration version, RLS/grants, cron registration/status, and safe auth redirect configuration. Write/migration actions remain separate explicit operator commands.

- [ ] Rehearse fresh setup and upgrade from legacy fixture using only the runbook. Assert migration preflight rejects missing backup acknowledgement/schema mismatch, and read-only readiness detects disabled RLS or missing cron without modifying data.
- [ ] Write public README instructions for Google/verified email login, guest five-hour expiry, Alice/Bob/Charlie buttons and fictional sample scenarios, midnight PHT reset, local tests, CI and security results. Explain demos are isolated per visitor and have no passwords. Do not mention employers or include privileged URLs/secrets.
- [ ] Document Google consent/redirect setup, Supabase confirmation and SMTP, secret placement, database/Cron settings, backups and maintenance-window cutover. Preserve archive privately; require explicit verified UUID mapping for future recovery. Rollback must keep authentication/RLS protection or enter maintenance mode, never restore public access.
- [ ] Run all tests, build, and readiness checks in staging. Manually verify Google and email delivery, cross-user denial, guest expiry, demo reset, cron failure/recovery, and transfer. Missing provider/admin access is a named external blocker, not completed deployment. Observe cleanup lag and job failures; record live rows versus backup retention distinction.
- [ ] Commit `docs: publish public demo and secure deployment guides`; request whole-branch review. Production merge/deployment follows the user's authorized release workflow only after critical/high findings and required checks are resolved.

## Completion checklist and handoff

- [ ] Every approved spec section maps to Tasks 1–15; no agreed capability silently omitted.
- [ ] All new regressions have an observed failing baseline and passing implementation, or an explicitly reported environmental verification gap.
- [ ] Exact commit's unit, SQL/RLS, API, production-build and browser tests pass in CI; report counts and links.
- [ ] Security report lists findings and residual operational risks; no service secrets or private fixture data in repo/artifacts.
- [ ] User reviews the final implementation PR and rollout prerequisites; no production readiness claim based solely on code merging.

Recommended execution: subagent-driven implementation with sequential task interfaces and review gates, followed by a whole-branch review. These tasks modify security boundaries and cleanup transactions, so independent review is valuable. Native implementation remains an option if the user prefers lower overhead.

Planning validation: this plan was self-reviewed against the approved design for requirement coverage, consistent interfaces, observable tests, and the five Review Focus cases. It describes future implementation and verification; no product code or tests were run as part of writing this plan.
