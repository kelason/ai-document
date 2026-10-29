# Coordinated cutover and recovery

Do not deploy this application's schema and UI independently. The old app used display-name identity and cannot safely serve the new database. No production migration has been performed during implementation.

## Preparation

1. Record the current application revision, environment configuration, Supabase project identifier, database/schema versions, role grants, exposed schemas, publication membership, Auth templates/provider settings and cron jobs. Keep secrets in the existing secure store.
2. Create a database backup through the provider's supported backup/export process, including Auth users, public data, storage metadata, roles/grants/extensions and required configuration. Encrypt exports, restrict access and record checksum, row counts, timestamp and recovery point. Do not put backups in the repository or CI artifacts.
3. Restore that backup into a separate staging project and demonstrate application/database recovery. Compare row counts and selected content/history/attachment relationships. A successful dump alone is not a tested backup.
4. Rehearse migrations 0001–0009 against the restored legacy schema using administrator credentials. Run `node scripts/check-migration.ts --preflight` with `DATABASE_URL` and `BACKUP_RESTORE_REHEARSAL_ID` set to the tested backup-rehearsal record. The guard requires that acknowledgement and rejects an unknown schema; it is read-only and does not prove that the backup was actually restored. Read its output before applying SQL. Unknown schema/view dependencies or archive collisions deliberately stop migration; inspect and resolve them without deleting legacy records.
5. Verify the legacy tables now exist only in `legacy_archive`, counts match the migration log/backup, relationships are preserved, and anon/authenticated/service_role cannot query them. Check publications and exposed schemas too. Never reassign archived documents based on Alice/Bob/Charlie names or the first signup.
6. Configure staging Auth/SMTP/Google/ingress/cron. Run all CI checks and manual Google + SMTP confirmation/recovery checks. Verify production-mode CSP, secure cookies, canonical callbacks and ingress IP spoof protection on the actual host.

## Cutover

1. Confirm release authorization and all release-readiness gates. Place the previous deployment in maintenance mode and stop writes. Record the final backup/recovery point; drain in-flight requests.
2. Apply reviewed versioned migrations using the administrator migration process. Never expose SQL or migration execution through an HTTP route. Migration 0001 takes locks and moves original data; use a maintenance window appropriate to table size.
3. Verify the private archive counts, new RLS/grants, service-only temporary RPCs, verified-profile synchronization, UTC cron schedule and logging. As administrator, run the read-only target checker: `psql "$DATABASE_URL" -X --set ON_ERROR_STOP=1 --file scripts/check-deployment.sql`. Keep credentials in the environment and do not echo them. This checks DB protections and job registration; it cannot prove external Auth/SMTP, API schema exposure, actual job success or a restored backup.
4. Deploy the app revision tested with this schema, with production environment variables and exact Auth templates/redirects. Clear old app caches and prevent old deployments from serving writes to the migrated project.
5. Smoke-test with dedicated disposable accounts: Google and verified email login; signup unverified denial; private document CRUD; owner/editor/viewer sharing/revocation; isolated demo fixtures; guest expiry boundary; explicit guest claim; import and restore; legacy URL redirect. Confirm no old production data appears in a new account.
6. Remove maintenance mode and monitor Auth errors, 403/429/503 rates, save failures, cron failures and cleanup lag. Retain the tested backup according to the retention policy.

## Failure and rollback

Before new production writes are enabled: keep maintenance mode on; roll back the entire application/database pair to the tested backup and recorded old configuration, following the rehearsal. Never serve the old app against the new schema or make archived tables public to restore access.

After new account data exists: stop writes and take another encrypted backup. Prefer a reviewed forward fix. A restore to the old recovery point would discard new work and requires an explicit data-reconciliation plan and authorization. Preserve new UUID-owned documents and Auth users; do not infer ownership during reconciliation. Test recovery in staging before reopening writes.

Do not run destructive down migrations or grant application roles access to `legacy_archive`. Archive inspection/export is an administrator operation. Restore requested archived content only through a separately reviewed, evidence-based ownership process.
