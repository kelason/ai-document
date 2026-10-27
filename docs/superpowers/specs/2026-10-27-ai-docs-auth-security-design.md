# AI Docs: accounts, public demos, testing, and security

Status: proposed design for approval; no product implementation authorized by this document alone.

## Intent and agreed requirements

Turn the existing Next.js/Supabase document editor into AI Docs with persistent real accounts and convenient public trials. Rename Antigravity Docs across the interface, metadata, templates, and documentation. Preserve the document-loading fix already merged into main.

Anyone may sign in with Google, or register with a display name, email, and password. Email/password registrations must verify their email before accessing persistent documents. Returning users can sign in with email/password. Google sign-in uses the provider consent flow and restores a valid session on later visits; it does not silently access a visitor's Google account.

Anyone may instead continue as a guest or select Alice, Bob, or Charlie without entering login credentials. Guest data expires five hours after the session starts. Demo data resets every midnight Philippine time (Asia/Manila, UTC+8), restoring mock documents. A daily reset is not a rolling 24-hour lifetime.

README instructions describe public demo access and test accounts. Do not use the word “employer” in the README or position access as restricted to a particular audience. No real credentials or shared passwords are published.

Add Vitest and extend the existing Playwright GitHub Actions workflow. Perform an OWASP-based security review, remediate identified application issues, and record evidence and remaining operational requirements.

## Approaches considered

1. **Selected by the user:** Supabase Auth for real users; separate restricted demo and guest sessions. This builds on the existing database, allows immediate public access, and avoids shared passwords. Temporary-session authorization must be implemented and tested explicitly.
2. Supabase Auth for everyone with public shared demo credentials. This resembles ordinary login but creates password-reset, account-recovery, and shared-account abuse problems. Rejected in favor of option 1.

This is a substantial authentication and data-access project, not just a branding or login-screen change.

## Current implementation and constraints

The repository uses Next.js 16.3.3, React, Supabase, and Playwright. Current users are hardcoded profiles selected in local storage. Document owners are display-name strings, and shares refer to demo profile IDs. Authorization currently lives primarily in the UI. Document, upload, sharing, and presence APIs do not authenticate callers. Database setup disables row-level security. A public GET migration route can mutate database contents. Imported HTML enters the editor without sanitization. JSON/memory fallbacks can hide production database failures.

The existing rich-text editor, outline, imports, history, and sharing should remain functional. Use the installed Next.js version's documentation before implementing framework changes. Do not replace the framework or editor merely to add authentication.

## Proposed product decisions for approval

These are implementation recommendations, not requirements previously specified by the user:

- Give each visitor a separate demo workspace containing all three personas. Switching Alice/Bob/Charlie changes the demo perspective in that workspace, allowing sharing demonstrations without exposing another visitor's edits. No globally shared mutable demo account.
- A guest has a blank private temporary workspace. Five hours is an absolute lifetime, not extended by activity or refreshing the page. Clearing cookies loses access; starting a new session does not recover expired data.
- Visitors may explicitly save their guest documents to a verified real account before expiry. Demo fixture data is never automatically copied into a real account.
- Preserve existing unverified legacy data in an administrator-only archive at migration. Do not infer ownership from names, email text, or first signup, and do not delete legacy documents automatically. Assigning archived documents to a verified owner requires an explicit administrator mapping later.
- Real-account sharing initially supports existing verified users by exact email. No public user directory, fuzzy email search, or pending invitations to unregistered addresses. Demo sharing is limited to the three personas in the same demo workspace. Guests cannot share.

## Entry, authentication, and account experience

Provide Google sign-in, email/password login, create account, continue as guest, and three clearly labeled demo choices. Real users have account identity and sign-out controls, replacing the simulated production identity switcher. Demo users retain a clearly marked persona switcher. Remove simulated Bob typing from real and guest modes; prefer real demo interactions over fake collaboration.

Use Supabase Auth with the supported SSR client integration, request-scoped clients, and validated server identity. Complete OAuth/verification callbacks using code exchange and an allowlisted local return path. Include resend verification, expired/invalid verification handling, forgot password, reset password, and sign-out. Verification is enforced at the API/database boundary, not merely by hiding the editor. A Google user is accepted only after the configured provider/auth service establishes a verified identity. Do not manually merge accounts solely because submitted emails match.

Google OAuth configuration, permitted redirect URLs, Supabase email confirmation, and production email delivery are deployment prerequisites. Use a production SMTP configuration suitable for public verification/password-reset delivery. Never collect credentials in chat or commit secrets. Document required settings and mark unavailable external configuration as a deployment blocker rather than claiming it works.

## Data model and permission boundaries

Persistent documents use immutable verified user UUIDs, not display names. Profiles hold display name/avatar; they do not grant roles. Shares record document ID, recipient UUID, and view/edit permission with uniqueness constraints. History, attachments, and presence are scoped to their document and authorized user. Display-name changes do not change ownership.

Enable RLS with deny-by-default policies. Owners may read, edit, delete, restore, upload, and manage shares. Editors may read, edit content/title, upload, and restore revisions; they cannot delete documents or manage shares. Viewers may read content/history/attachment metadata and participate in read-only presence; they cannot mutate documents. Verification and permissions apply to list, single-document, history, sharing, upload, restore, delete, and presence operations, including direct Supabase access. Profile/email lookup must not expose the Auth user table or arbitrary profile lists.

Use user-scoped Supabase clients for normal real-user requests. Reserve any service-role credential for narrow server-only administration or temporary-workspace operations; never expose it or make it the normal authorization mechanism for real users.

Store temporary sessions/workspaces separately from real-user tables, in a private non-public schema. Issue a cryptographically random opaque token in a Secure, HttpOnly, SameSite cookie; store only its hash. Database records determine workspace type, active persona, creation time, expiry, and reset generation. A persona name, document ID, or client-supplied role alone never authorizes access.

Expose narrowly scoped server-only database functions for temporary data. Every operation validates the token hash, workspace scope, document permission, and expiry in the database transaction. Fix function search paths, qualify referenced objects, and revoke public execution. Temporary functions cannot read or mutate persistent-user tables. Validate the same boundary in route handlers; never pass arbitrary table names or SQL from requests.

Temporary histories, shares, attachment metadata, and presence use workspace-scoped foreign keys and cascade on cleanup. Demo fixture IDs are distinct for each workspace/generation. Persistent and temporary data must never share caches; use private/no-store responses for account-specific content. Production database errors fail closed rather than switching to a JSON or in-memory database.

## Guest expiration and demo reset

The database supplies authoritative time. Guest expiry is created_at plus five hours. At that instant all access and writes are denied even if cleanup is delayed. A database cleanup job runs every minute to remove expired workspace data. UI shows the expiry time and a warning before it happens; expired sessions return to a clear start-again screen. Residual browser content is cleared on expiry and checked again on focus/reconnect; offline copies or platform backups cannot be retroactively erased. Document this distinction from live app retention.

Demo data expires at the next midnight in Asia/Manila, which is 16:00 UTC on the preceding UTC calendar date. Use Supabase Cron, with explicit UTC scheduling and a transaction-safe reset procedure. At midnight old generations become inaccessible independently of job timing. On the next request, recreate that visitor's demo fixture set once under a workspace lock, maintaining the selected persona. Cron proactively removes expired demo generations; failures are observable and retryable. Writes begun before the boundary must revalidate time/generation under the same transaction lock, preventing an old save from reaching the new generation. A stale client receives a reset response and reloads the new fixture set instead of silently saving old content.

Seed each demo workspace with Alice's project proposal, Bob's meeting notes, and Charlie's software specification, plus seeded history and view/edit sharing examples between them. Seed only fictional content. Reset removes created documents, edits, deletions, added revisions, shares, attachment metadata, and presence, then restores fixtures. Keep seed definitions deterministic and idempotent. Anonymous demo-session records also need bounded retention: expire inactive demo sessions after 24 hours without activity, purge their token hashes and workspaces, and recreate a fresh session on a later visit.

Guest-to-account save requires explicit action, a verified real session, and proof of the unexpired guest cookie. Copy documents/history with fresh persistent IDs and owner UUID, drop temporary permissions/presence, and delete temporary data only after a successful atomic transfer. Lock the guest workspace so cleanup and duplicate submissions cannot cause partial transfer or duplication. If verification completes after expiry, the data cannot be claimed. Demo selections never create a transfer claim.

## Security work and operational controls

Use OWASP ASVS 5.0 as a testable baseline, focusing on applicable Level 1 requirements and deeper authorization checks for this multi-user app. Map findings to OWASP categories with severity, affected code, reproduction, fix, and verification. Do not describe this as certification or a complete penetration test.

Address the known access-control gaps, public mutation migration endpoint, untrusted identity fields, disabled RLS, unsafe HTML/import handling, and production fallback behavior. Replace public migration with an explicit operator-run migration. Sanitize stored/imported HTML and dangerous URL protocols on the server; escape text imports and sanitize legacy content before rendering. Apply bounded document/request/upload sizes and archive expansion limits to DOCX handling. Preserve only supported editor markup/styles and test valid formatting alongside attack payloads.

Protect cookie-authenticated writes against CSRF with origin checks and an appropriate token strategy; use POST for state changes. Validate OAuth return URLs. Add CSP and other applicable headers without breaking the editor or auth flow. Handle errors generically, avoid account enumeration, and never log tokens, document bodies, passwords, or verification links.

Apply durable rate limits to session creation, login/verification actions, document mutations, and uploads; do not use per-instance memory limits. Proposed initial quotas: 20 documents per guest/demo workspace, 1 MiB HTML per document, existing 5 MiB upload cap, bounded history and total temporary storage. Tune exact burst/rate limits during implementation, documenting choices. Rate-limit before expensive parsing and include automatic retention for limiter records. Database functions and quotas are the backstop for public unauthenticated access.

Review dependencies and lockfile, secret exposure, build/deployment configuration, logging, and external services. Add dependency review, secret scanning where supported, and static security checks in CI. Run active security tests against isolated local/preview fixtures, never destructively against public real-user documents.

## Test and CI design

Vitest covers validation, HTML sanitization, permissions, session-token verification, guest expiry, midnight PHT calculations, demo generations, quota enforcement, and transfer/reset races with a controlled clock. Tests must assert behavior, including negative cases, not mirror implementation constants.

Integration tests run against an isolated local Supabase instance with migrations/RLS enabled and test-only fixtures. Test direct database access as anonymous, unverified, owner, editor, viewer, unrelated user, expired guest, and wrong demo workspace. Test concurrent reset/seed and guest transfer/cleanup. Include fixtures and histories that expose cross-document permission mistakes.

Playwright covers Google entry/callback behavior using controlled integration boundaries, email registration and verification using a local test inbox, email login/reset/sign-out, guest creation/expiry/claim, all demo personas, sharing, reset recovery, and existing editor workflows. Live Google OAuth gets a manual staging smoke check; CI must not use real Google passwords. Mocked provider tests do not substitute for the RLS and API integration suite.

GitHub Actions runs lockfile install, lint/typecheck, Vitest, Supabase integration tests, production build, and Playwright against the built app. Use a pinned supported Node LTS, install only required browsers, upload failure artifacts, give jobs minimal permissions, and use no production data or production database secrets. Existing tests must be updated for intentional auth changes, not disabled. Record tests and unresolved security findings in the PR.

## Migration, deployment, and documentation

Back up production before schema changes. Produce reviewed versioned migrations and a rollback/runbook. Quarantine legacy rows in a private archive, invalidate old simulated sharing semantics, deploy authenticated access with RLS together, and seed demo data only into separate temporary tables. Do not enable RLS halfway through a deployment that still relies on unauthenticated queries. Use a maintenance window or equivalent controlled cutover; verify rollback does not reopen anonymous access.

README includes AI Docs branding, public URL, Google and verified-email usage, guest five-hour retention, Alice/Bob/Charlie demo buttons and fictional sample scenarios, daily midnight PHT reset, local setup, auth/email settings, migrations, cron registration/monitoring, test commands, CI, security-report location, and deployment verification. No demo passwords, privileged endpoints, real account credentials, or confidential data.

Provisioning changes to Supabase, Google Cloud, SMTP, and Vercel require access to those accounts; repository changes alone cannot configure them. Implementation can prepare exact setup instructions and migrations without access. Production deployment is complete only after those prerequisites and real sign-in, isolation, and cleanup smoke checks pass.

## Acceptance and exclusions

Acceptance: AI Docs branding; verified real Google/email accounts; no fake identity switch for real users; public isolated demo personas with documented fixtures and midnight reset; guests with enforced five-hour expiry; enforced ownership/sharing on every API and database path; existing editor features retained; both Vitest and Playwright plus RLS integration tests green in CI; documented OWASP findings with critical/high issues fixed or explicitly blocked from deployment.

Out of scope: billing, organization workspaces, public document links, arbitrary user discovery, real-time CRDT redesign, and claiming recovery of previously missing documents. Existing attachment behavior is content import plus metadata, not a promised persistent binary download service. Choose specific libraries, file boundaries, rate-limit values, and implementation task sizes in the implementation plan, consistent with this design.

## References

- Supabase SSR integration: https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs
- Supabase Google sign-in: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- Supabase Cron: https://supabase.com/docs/guides/cron
- OWASP ASVS: https://asvs.owasp.org/
