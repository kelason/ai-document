# CI release gates

The `AI Docs checks` workflow runs on pull requests and main pushes. Required review checks are **unit**, **database-and-browser**, **secrets**, **dependency-review** (PRs) and **codeql**. A repository administrator must configure branch protection/rules to require these checks before merging; the workflow file alone cannot enforce repository merge policy.

- Unit: clean lockfile install, ESLint, TypeScript, Vitest and `npm audit --audit-level=high`.
- Database/browser: Supabase CLI2.122.0 on disposable Docker containers, no production secrets; pgTAP, real Auth/PostgREST/RLS and API integration; production standalone build; public client-secret scan; Playwright. SQL/integration/browser layers repeat after an empty reset.
- Secrets: checksum-verified Gitleaks8.30.1 scans Git history and a tracked-source export. Generated `.next`/test keys are not source files and no rules are globally disabled.
- Dependency review: high-severity additions block PR checks. Audit also covers the complete lockfile rather than just additions.
- CodeQL: pinned action, JavaScript/TypeScript security-extended queries, no build required. Review code-scanning alerts as well as job completion; configure code-scanning merge protection for actionable high/critical findings where supported.

Actions are pinned to commit SHAs and jobs have timeouts, minimum permissions and concurrency cancellation. Tests use loopback-only database/mail helpers, unique identities and a local HTTPS proxy. Provider/production secrets are not passed to workflows. Account traces/video/screenshots and sensitive artifacts are not uploaded. Local test keys are masked and reporter token parameters are redacted.

Dependabot opens weekly npm and GitHub Action updates. No automatic merge is configured. Investigate high/critical findings; fix reachable risks before release or record a named blocking reason. Treat a failed or unrun check as a release blocker, never as a pass. Keep remaining medium/low findings in the security review with ownership and operational follow-up.
