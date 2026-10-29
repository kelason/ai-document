# Operations and retention

Keep the database, application and Auth configuration at the coordinated release version. Use `scripts/check-deployment.ts` for read-only environment/database checks, then complete the external checks in release-readiness. It cannot verify a backup restore or provider settings on your behalf.

## Temporary data

Guests have an absolute five-hour deadline; visitor demos reset content at midnight Asia/Manila (16:00 UTC) and expire after 24 hours without activity. The minute cleanup job physically removes expired temporary workspaces. Database access checks and deferred commit guards continue enforcing deadlines if cron is delayed or fails. Personal-account records are excluded from these jobs.

Monitor `cron.job_run_details` for failed `ai-docs-*` runs, missing successful minute cleanup for more than two minutes and unexpected reset times. `temporary_private.maintenance_runs` stores safe success counts. Keep access administrator-only. Re-enable/recover failed jobs under the operations process, verify one successful run, and confirm expired rows are physically removed. Never extend expiry or disable guards to make maintenance pass.

Guest claim receipts contain destination document IDs and minimal identity/expiry metadata, never source HTML, and expire after 24 hours. Scheduled receipt cleanup removes them. Old rate-limit records and maintenance records have their own bounded retention. Avoid exporting temporary content into troubleshooting logs.

Expiry/reset describes **live database rows and access**, not instantaneous erasure from existing backups. Configure, document and restrict the provider's encrypted backup retention before release. Restoring a backup can restore old temporary rows; run the guarded cleanup/reset procedures and verify deadlines before reopening access. Do not promise five-hour or midnight deletion from immutable backups unless the actual backup policy supports it.

## Incidents and alerts

Track Auth delivery failures, 403/429/503 rates, save failures, database/RPC latency, import worker timeout/termination and quota saturation. Add privacy-preserving authorization events and alert routing as identified by the OWASP review's open medium finding. Never log passwords, tokens, raw cookies, cookie hashes, full email links, service keys or document HTML.

For a compromised service key, enter maintenance mode as appropriate, rotate the key through the provider secret store, redeploy the matching server configuration, invalidate affected temporary credentials and investigate exposure. Preserve restricted incident evidence. Secret rotation does not repair leaked content; assess what was accessed.

Review dependency audit/CodeQL/Gitleaks and Dependabot updates regularly. High/critical reachable findings block release. Test fixes against the isolated stack and promote the coordinated app/schema pair through staging.

## Recovery

Follow [cutover and recovery](cutover.md). Stop writes before a restore; retain a new encrypted recovery snapshot; reconcile any real account data created after the old recovery point. Keep RLS and Auth protection enabled or keep maintenance mode active. Archived legacy data stays administrator-only and requires separately reviewed evidence-based UUID ownership mapping before recovery to an account.
