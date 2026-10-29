# Release readiness

Updated 2026-10-29. **Not deployed to production.** Work is on the [draft PR](https://github.com/kelason/ai-document/pull/2). The live site may still run the previous release until the coordinated cutover completes.

| Gate | Evidence / status |
| --- | --- |
| Approved design and implementation plan | Committed under `docs/superpowers/` |
| Unit / lint / TypeScript | Local: 224 unit tests passed; lint and type checks passed |
| Standalone production build | Passed locally; actual script nonces and security headers inspected |
| Dependency audit | 2026-10-29: zero reported vulnerabilities |
| Secret scanning | Gitleaks 8.30.1 history scan clean; final tracked-source/CI scan pending |
| Public client secret leakage check | 28 public build files checked; server secret canaries absent |
| Supabase SQL/RLS/Auth/integration | Earlier foundation CI passed; expanded current run pending |
| Browser tests, packaged worker, empty-db repeat | Current CI pending; local macOS Chromium launch blocked |
| Fresh implementation review | Pending |
| Google OAuth | Production/staging provider configuration and manual sign-in required |
| Verified SMTP / confirmation and recovery delivery | Production sender/configuration and real-mailbox smoke tests required |
| Trusted ingress | Header replacement and direct-origin protection must be checked on actual host |
| Cron | Verify UTC scheduler, active jobs, successful runs and cleanup-lag alerts on target project |
| Backup / archive / rollback rehearsal | Requires administrator access and restored staging backup; not performed on production |
| Security telemetry | Medium open item in OWASP review; scope and alerting owner required |

Do not merge/deploy partial feature commits or run production migrations as a CI side effect. Follow [cutover](cutover.md); keep the previous app in maintenance mode during the schema/app switch. Google/SMTP/hosting settings are external requirements, not failures that tests can bypass.
