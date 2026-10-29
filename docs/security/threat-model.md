# AI Docs threat model

Reviewed 2026-10-29 against the approved design. This describes the implementation's trust boundaries and residual operational requirements, not a certification.

## Assets and boundaries

| Boundary | Assets and threats | Controls |
| --- | --- | --- |
| Public browser → Next routes/actions | Forged identity, CSRF, guessed document IDs, stale UI/cache, malicious rich text | Verified Auth lookup, explicit signed mode, strict input schemas, origin + context-bound CSRF, no-store responses, server authorization, browser sanitization, scoped invalidation-only BroadcastChannel |
| Next → Supabase Auth | Forged/stale sessions, unverified accounts, callback replay, off-site redirects, account enumeration | Network-validated identity, current protected verification/ban/deletion checks, provider PKCE, one-use email token hashes, local return-path validation, generic email responses, shared auth limits |
| User SSR client → PostgREST | Horizontal/vertical privilege escalation and share revocation | User-scoped client, verified-owner/editor/viewer RLS, atomic security-definer RPCs, restricted grants, safe profile column access |
| Next service key → private temporary RPCs | Cross-visitor access, demo-to-real escalation, stolen cookie, arbitrary identity input | Service-only finite RPC surface; opaque 256-bit tokens, stored SHA-256; private schemas; workspace/session locks; no persistent access from temporary operations; server-only service-key factory |
| Guest claim → persistent storage | Duplicate copy, race with cleanup/edits, expiry during transfer, forged ownership | Explicit verified action with real-session CSRF; retained guest proof; ordered locks and receipt serialization; snapshot comparison; sanitization; new IDs; atomic copy/delete; deferred commit deadline; 24-hour IDs-only receipt |
| Database cron → temporary storage | Delayed cleanup, timezone drift, reset/write race, indefinite retained receipts | Fresh database clocks; hard expiry on reads/writes and commit; generation guard; UTC scheduler verified; minute purge; midnight-PHT reset; private maintenance counts and cron run logs |
| Untrusted file → import worker | XSS, XXE/external relationships, ZIP bombs/traversal, central/local parser disagreement, resource exhaustion | Extension/MIME/signature checks; 5 MiB input, 20 MiB expansion, 100:1 ratio, 2,000 entries; canonical archive validation/rebuild; CRC and metadata checks; XML checks; 5-second worker deadline; sanitized 1 MiB output |
| CI/build → repository/host | Production credential leakage, untrusted dependencies/actions, accidental deployment | Disposable local stack, loopback-only fixtures, masked test credentials, no account traces/artifacts, lockfile, Node/tool/action pins, dependency + secret scans, public-bundle secret-value check, draft PR and coordinated release gates |
| Administrator → legacy archive | Accidental deletion/exposure or identity inference | Move original tables intact, revoke all app-role access, remove publications/policies, archive logs, backup/restore rehearsal and explicit recovery process |

## Trusted components

Next/Node, Supabase Auth/Postgres, the administrator migration process, configured trusted ingress, hosting secret store and reviewed CI actions are trusted. A leaked service key compromises the privileged server boundary; rotate it, review logs, invalidate temporary credentials and investigate. Application protections cannot compensate for a public database administrator password or compromised host.

Auth cookies are HttpOnly, Secure on HTTPS and SameSite Lax; temporary/mode cookies use the appropriate host-only settings. Browser SDK code is not used for app authorization. XSS defense still requires sanitization and CSP: HttpOnly alone does not stop an injected script from making same-origin actions.

## Explicit decisions

- A guest is one visitor workspace with a fixed five-hour lifetime. A demo is a separate per-visitor workspace with shared fictional personas, midnight-PHT content reset and a 24-hour inactivity limit.
- No public shared passwords or inferred name-based account ownership. Demo sharing never crosses its workspace; guests cannot share.
- Original uploaded files are never stored. Placeholder attachment URLs, shares and presence do not transfer into real accounts.
- Browser time only triggers a server recheck. Database time and transaction locks determine access and transfer success. The cleanup scheduler is not an authorization control.
- Script CSP uses a per-request nonce and dynamic rendering. Sanitized editor/React style attributes require `style-src 'unsafe-inline'`; production script policy does not allow inline-script or eval exceptions.
- Real account session lifetimes and provider abuse protections require production configuration. Google and verified SMTP cannot be proven by mocks or by the local inbox.
- Revocation takes effect on the next authorized request. An operation already authorized and locked may finish before a concurrent revocation; no offline access or document HTML is sent over BroadcastChannel.

## Remaining operational risks

Verify ingress header replacement/direct-origin blocking; never trust arbitrary client IP headers. Set deployment quotas and Auth protections; monitor shared limiter failures. Validate SMTP sender and Google consent/callback settings. Alert on cron failure and cleanup lag. Add safe application-level authorization event telemetry without content, tokens, cookie hashes or full email links. Supabase Auth/cron logs cover their own domains but do not constitute complete application security monitoring.

Run the release suite and staging smoke tests before production. See [OWASP findings](owasp-review.md) and [release readiness](../deployment/release-readiness.md).
