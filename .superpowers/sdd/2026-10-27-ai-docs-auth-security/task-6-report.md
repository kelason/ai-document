# Task 6 report: temporary session and storage isolation

Implemented for the coordinated release. Task 7 supplies actual demo fixtures, boundary reset and cleanup in SQL006; SQL005 alone must not deploy. No production data, accounts, credentials or remote service was used.

## Changes and decisions

- `temporary_private` owns workspaces, sessions, documents, history, shares, attachments and presence. There are no foreign keys or queries into persistent-user tables. All tables have RLS enabled and all schema/table/function privileges are revoked from PUBLIC, anon, authenticated and service_role. Service role receives only explicit public SECURITY DEFINER wrappers with empty search_path.
- A finite private dispatcher implements every DocumentStore operation. All operations authenticate the token hash, acquire the workspace then session lock, inspect a fresh database clock after acquiring the lock, check expected generation, and derive the current persona/permissions from DB state. Browser owner IDs cannot affect authority. Every operation checks workspace membership. Shared viewers read/send presence; editors additionally update/upload/restore; owners delete/manage shares. Guests cannot share or switch personas.
- Locks serialize workspace quotas across concurrent mutations: 20 documents, 1 MiB UTF8 HTML each, 50 retained history revisions per document, 25 MiB combined live/history HTML per workspace. History is pruned to the latest 50; a rejected quota write rolls its document/history changes back together. Guest starts empty. Demo SQL005 establishes only the Task 7 seed extension point.
- Cookie material is 32 cryptographically random bytes encoded base64url; only its SHA-256 hex hash goes to SQL. Cookie names are `[__Host-]ai-docs-guest` and `[__Host-]ai-docs-demo` (prefix on HTTPS). Cookies are HttpOnly, SameSite=Lax, Path=/, Secure on HTTPS; canonical APP_ORIGIN refuses HTTP in production. Guest cookie expires at the DB's fixed five-hour deadline. Demo cookie has Max-Age 86400 and is refreshed only by explicit writable GET validation. DB inactivity expiry is independent of the cookie.
- Starting the same temporary mode replaces its credential and deletes the old workspace by hash. Guest and demo cookies are separate. Starting another mode preserves the inactive cookie; real login keeps guest data for the later explicit Task 10 claim. No implicit claim exists.
- Ruling: preserve inactive mode cookies, rather than destroy a guest on demo selection, because signed mode is selection only and explicit retained-guest claim is required. Inactive cookies never become an implicit authorization fallback; fixed guest expiry still applies. Cost if wrong: temporarily retaining inaccessible unused workspace rows until cleanup.
- Ruling: use an inert attachment placeholder path `/attachments/<hex-or-UUID>` consistently in SQL and repository validation; upload metadata never provides arbitrary executable/external URLs. Task 9 generates a UUID placeholder. Cost if wrong: future real object storage requires a deliberate URL contract update.
- Added the durable `supabase/tests/temporary.test.sql` pgTAP coverage in addition to the named integration test, so private grants, quota rollback and cascade behavior are verified below PostgREST. Tests are transactional and use synthetic local fixtures.

## TypeScript contracts

`lib/temporary/sessions.ts` is server-only:

- `startTemporarySession(kind:'guest'|'demo',persona?:DemoPersona):Promise<TemporaryActor>` creates credential/session and sets the signed selected mode. Demo requires an explicit allowed persona.
- `getTemporarySession():Promise<TemporaryActor|null>` reads only the selected temporary mode. Missing/malformed cookie returns null; valid-looking expired credentials throw SESSION_EXPIRED. Database/storage failure throws STORAGE_UNAVAILABLE.
- `getTemporaryCredential(kind?:'guest'|'demo',options?:{refreshCookie?:boolean}):Promise<TemporaryCredential|null>` returns an internal branded `{tokenHash,actor}`. Without explicit kind it follows signed selected mode and never falls back to a retained guest. Explicit `guest` is reserved for the authorized Task 10 claim flow. Use refreshCookie only in route/action contexts; default reads are safe for Server Components.
- `temporarySessionBinding(credential):Promise<string>` supplies `temporary:<hash>` to CSRF internally. Never serialize this binding.
- `switchDemoPersona(persona,expectedGeneration?):Promise<TemporaryActor>` revalidates session and asks SQL to persist the persona. The route always supplies the original request header generation; internal callers omitting it use the current validated generation.
- `endTemporarySession():Promise<void>` deletes only the selected temporary workspace by hash, clears its cookie and clears selected mode. Expired credentials can end their own workspace without reviving access.
- `temporaryCookieName(kind)` names cookies; `temporaryRpc<T>(name,args)` is the server-only RPC/error adapter used by the store and session functions. Only known standard SQL messages map to public ApiErrors; unknown/provider details become the generic STORAGE_UNAVAILABLE message.

`createTemporaryStore(credential,expectedGeneration):DocumentStore` has all common contract methods. Every call sends the credential hash and expected generation to SQL; actor metadata alone never authorizes. The repository validates UUIDs, strict input fields, persona share recipients, presence coordinates and attachment metadata. Create/update content passes the existing sanitizer. No memory/JSON fallback exists.

## HTTP/client contract

Every response uses `Cache-Control: private, no-store` and `Vary: Cookie`. JSON bodies with metadata also include `serverNow` as an ISO timestamp from the application server for countdown offset; only DB time authorizes access.

`GET /api/session` returns:

```
{ serverNow, session: null | TemporaryActor | {
    kind: 'user', userId, displayName, email
  }, csrfToken }
```

TemporaryActor is the common safe actor DTO: kind, workspaceId, sessionId, generation, expiresAt, plus persona for demo. It has no cookie/hash/store. Guest expiresAt is fixed expiry; demo expiresAt is next Manila reset, not inactivity expiry. User metadata requires getVerifiedUser, a validated auth session binding and the current user-scoped `profiles` row. An authenticated unverified account receives session:null with an auth-bound CSRF token, allowing safe signout or temporary selection.

No selected/valid session creates signed HttpOnly preauth bootstrap and consumes the durable session-IP limit. Expired/reset selected session returns HTTP410/409 with `{serverNow,session:null,csrfToken,error,code}` plus fresh preauth cookie; this allows deliberate replacement. SQL006 metadata reads with NULL expected generation normally refresh/reset instead of returning DEMO_RESET. Other errors keep standard `{error,code}`. Cross-origin/cross-site GETs are rejected when those headers are supplied.

`POST /api/session` accepts exactly `{kind:'guest'}` or `{kind:'demo',persona:'alice'|'bob'|'charlie'}`. Require canonical Origin + `X-CSRF-Token` bound to the current selected temporary credential, current validated auth session, or signed preauth bootstrap. Durable session-IP limit runs before body parsing. Success is HTTP201 `{serverNow,session:TemporaryActor,csrfToken}` with the new context's token.

`POST /api/session/persona` accepts `{persona}` with canonical Origin, `X-CSRF-Token`, and `X-Workspace-Generation`. The generation must be a positive integer, is carried through to SQL, and cannot prove access. Consume the temporary-session mutation limit before parsing. Guests receive FORBIDDEN. Success is `{serverNow,session:TemporaryActor,csrfToken}`; stale generation is DEMO_RESET/409.

## SQL and Task 7 extension contracts

- `workspaces(id uuid,kind,generation integer,created_at,expires_at,reset_at)`: guest expires_at nonnull/reset_at null; demo expires_at null/reset_at next Manila midnight.
- `sessions(id uuid,workspace_id UNIQUE,token_hash UNIQUE,persona,created_at,last_active_at,expires_at)`: guest expires_at fixed at creation +5h; demo expires_at +24h after validated activity. One session per workspace; workspace deletion cascades through all temporary data.
- `temporary_private.lock_session(p_token_hash text,p_expected_generation integer DEFAULT NULL) RETURNS temporary_private.sessions`: locks workspace then session. SQL005 checks fixed expiry/reset boundary, generation and touches activity. SQL006 replaces this helper to support reset while preserving the same return type and lock order. NULL expected generation is only metadata refresh, never a DocumentStore operation. All mutations acquire this lock before checking quota or document rights.
- `temporary_private.seed_demo(p_workspace_id uuid) RETURNS void`: called from `temporary_start` for demo. SQL005 is a no-op; SQL006 replaces it with all three personas' fixtures.
- `temporary_private.session_json(s temporary_private.sessions) RETURNS jsonb`: safe actor JSON, derives demo expiry from reset_at and guest expiry from workspace.expires_at.
- Other private helpers: `document_role`, `document_json`, `share_json`, `attachment_json`, `document_operation`. No dynamic SQL or dynamic table names exist in the runtime dispatcher.
- Public session RPCs: `temporary_start(p_token_hash,p_kind,p_persona DEFAULT NULL)`, `temporary_session(p_token_hash)`, `temporary_persona(p_token_hash,p_expected_generation,p_persona)`, `temporary_end(p_token_hash)`.
- Public document RPCs all take `p_token_hash text,p_expected_generation integer` first. `temporary_list`; `temporary_get(p_id)`; `temporary_create(p_input jsonb)`; `temporary_update(p_id,p_input)`; `temporary_remove(p_id)`; `temporary_restore(p_id,p_version_id)`; `temporary_list_shares(p_id)`; `temporary_grant_share(p_id,p_recipient jsonb,p_permission text)`; `temporary_revoke_share(p_id,p_share_id)`; `temporary_add_attachment(p_id,p_input)`; `temporary_heartbeat(p_id,p_input)`. They return the common JSON DTO; remove/revoke return JSON null. All IDs are UUID parameters.
- SQL error messages are exactly SESSION_EXPIRED, DEMO_RESET, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, QUOTA_EXCEEDED (SQLSTATE P0001). Unknown exceptions never leak database details to clients.

## Verification evidence and limits

- RED: real integration suite first failed its required local-stack setup; missing Supabase test keys are explicitly an environment blocker, not proof of a production behavior failure. A separate PGlite run against absent SQL005 failed on missing temporary_start; unit test import initially failed on absent session modules. Logs: task-6-red.log, task-6-sql-red.log, task-6-unit-red.log.
- SQL green: `node ../sql-harness/temporary.mjs` — 43 assertions pass applying SQL005 against PGlite with local TAP-equivalent assertion functions. Covers grants/schema/RLS, cross-visitor and guessed credentials, all permission levels, share revocation, guest restrictions, byte/document/history/combined quotas with rollback, fixed expiry and cascading deletion. The harness caught/fixed a real ambiguous PLpgSQL presence identity variable.
- Unit green: `npm run test:unit` — 9 files / 188 tests pass, including 14 Task 6 tests. One intermediate run saw Task 7's seven intended RED expiry tests while that agent worked; the final full rerun is green.
- `npx tsc --noEmit` and scoped ESLint — pass. Installed Next cookie and route-handler documentation inspected; cookies are asynchronous and writes are confined to routes/actions.
- `npm run test:integration -- tests/integration/temporary.test.ts` — fails beforeAll with missing local SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SERVICE_ROLE_KEY. Four dependent test cases are reported skipped by Vitest after setup failure, not deliberately skipped by code. Cases cover anonymous/private-schema denial, two visitors, guest restrictions, concurrent twenty-document enforcement, histories, persona permissions/revocation, and inability to read/update/delete actual persistent-user records.
- PGlite is not Supabase Auth, PostgREST, real pgTAP or multi-connection PostgreSQL. Real integration execution and concurrent lock/quota behavior remain release gates in local Supabase/CI. No fallback or weakened production assertion was added to bypass unavailable Docker.
- Task 7 owns expiry/reset fixtures and race tests; Task 9 owns application context composition/document routes and mutation rate limits; Task 10 owns explicit guest claim. Whole-branch review remains the coordinator's gate.
