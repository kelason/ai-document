# Release readiness

Updated 2026-10-29. **Not deployed to production.** Work is on the [draft PR](https://github.com/kelason/ai-document/pull/2). The live site may still run the previous release until the coordinated cutover completes.

| Gate | Evidence / status |
| --- | --- |
| Approved design and implementation plan | Committed under `docs/superpowers/` |
| Unit / lint / TypeScript | Local: 236 unit tests passed; lint and type checks passed |
| Standalone production build | Passed locally; actual script nonces and security headers inspected |
| Dependency review | Blocked: enable repository Dependency graph; npm audit separately passes |
| CodeQL | Security-extended scan and CodeQL check passed on remote67e9ba3 |
| Dependency audit | 2026-10-29: zero reported vulnerabilities |
| Secret scanning | Gitleaks 8.30.1 history scan clean; tracked-source export and CI history/source scans clean |
| Public client secret leakage check | 28 public build files checked; server secret canaries absent |
| Supabase SQL/RLS/Auth/integration | Remote67e9ba3: **182 pgTAP +54 real integration tests passed twice** |
| Browser tests, packaged worker, empty-db repeat | Remote67e9ba3: **19 Playwright tests passed twice** against standalone production build, with an empty database reset between runs |
| Fresh implementation review | Fresh review found no critical issues; all three important findings reproduced and fixed, with passing regressions |
| Google OAuth | Production/staging provider configuration and manual sign-in required |
| Verified SMTP / confirmation and recovery delivery | Production sender/configuration and real-mailbox smoke tests required |
| Trusted ingress | Header replacement and direct-origin protection must be checked on actual host |
| Cron | Verify UTC scheduler, active jobs, successful runs and cleanup-lag alerts on target project |
| Backup / archive / rollback rehearsal | Requires administrator access and restored staging backup; not performed on production |
| Security telemetry | Medium open item in OWASP review; scope and alerting owner required |

Do not merge/deploy partial feature commits or run production migrations as a CI side effect. Follow [cutover](cutover.md); keep the previous app in maintenance mode during the schema/app switch. Google/SMTP/hosting settings are external requirements, not failures that tests can bypass.

Verification: [CI run40847403252](https://github.com/kelason/ai-document/actions/runs/40847403252) checks commit `67e9ba397bbbf6d0fafd88279ba3de29036948ee`. Unit, database-and-browser, secrets, codeql and CodeQL checks passed. Dependency-review remains failed because repository Dependency graph is disabled; this gate was not bypassed. Documentation-only verification updates follow this tested implementation.

The administrator read-only readiness guard and its disabled-RLS/missing-cron negative tests passed against the isolated stack. This does not verify production Google/SMTP/ingress/cron operation or a production backup restore. Those external gates remain open.
