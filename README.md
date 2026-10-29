# AI Docs

A document workspace built with Next.js, React and Supabase: rich text editing, autosave, revision history, file import and permission-based sharing.

[Open AI Docs](https://ai-document-black.vercel.app/) · [Setup and deployment](docs/deployment/setup.md) · [Security review](docs/security/owasp-review.md)

## Try the public demos

On the welcome screen, choose **Try Alice demo**, **Try Bob demo**, or **Try Charlie demo**. No email or password is required. These are fictional demo personas, and each visitor gets a separate workspace. Switch personas in the workspace header to try owner, editor and viewer permissions.

| Persona | Own sample document | Can edit | Can view |
| --- | --- | --- | --- |
| Alice | Community Garden Proposal | Garden Watering Specification | Garden Planning Meeting Notes |
| Bob | Garden Planning Meeting Notes | Community Garden Proposal | Garden Watering Specification |
| Charlie | Garden Watering Specification | Garden Planning Meeting Notes | Community Garden Proposal |

The samples include formatted content, revision history and sharing examples. Fixtures live in [supabase/fixtures/demo.json](supabase/fixtures/demo.json). Demo data resets at **12:00 midnight Philippine time (Asia/Manila, UTC+8)**, restoring these samples. Inactive demo sessions expire after 24 hours. Avoid putting personal information into temporary workspaces.

Choose **Continue as guest** for an empty workspace. Guest data expires exactly **five hours after creation**. To keep it, create and verify an account or log in before the deadline, then explicitly select **Save guest work**. Logging in alone does not transfer data. A transfer keeps documents and revisions; demo shares, presence and placeholder file links are not copied.

## Personal accounts

Use **Continue with Google**, or register a display name, email and password. Email registrations require verification before accessing permanent documents. Password reset and verification resend are available from the login pages. Share with the exact email of an existing verified account, choosing view or edit access.

Account documents persist separately from temporary workspaces. Only owners manage sharing and deletion. Viewers cannot edit or import files. Document URLs require authorization; knowing an ID does not grant access.

## Editor and imports

- Rich text, headings, lists, links and tables; autosave and up to 50 revisions per document.
- Import `.txt`, `.md` or `.docx`, up to 5 MiB. HTML is sanitized; active content and unsafe archives are rejected.
- Imports convert file contents into document HTML. **Original binary files are not stored or downloadable.** Attachment entries are metadata placeholders.
- Temporary workspaces allow 20 documents, 1 MiB of HTML per document and 25 MiB of combined document/revision HTML.

## Local development

Use Node **24.22.1**, Docker and Supabase CLI **2.122.0**.

```sh
git clone https://github.com/kelason/ai-document.git
cd ai-document
npm ci
supabase start
cp .env.example .env.local
```

Fill in the local URL and keys from `supabase status`; generate independent CSRF and rate-limit secrets. Set `APP_ORIGIN=http://localhost:3000` for `npm run dev`. See [setup](docs/deployment/setup.md) for ingress configuration and local test credentials. Never commit `.env.local` or a service-role key.

```sh
npm run dev
```

## Testing

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:db
npm run test:integration
npm run build
npm run test:e2e
```

Database and browser tests use a disposable **local Supabase stack**, including its mail inbox, with no production credentials. Export the environment described in [the test guide](docs/deployment/testing.md). `test:db` resets the local database. Browser tests run the standalone production build behind a local HTTPS proxy; they do not run against the live site.

GitHub Actions runs Vitest, SQL/RLS and Auth integration tests, Playwright, lint, type checks, build, dependency audit, secret scanning and a public-bundle secret check. The complete database/browser sequence repeats after an empty database reset. See [release readiness](docs/deployment/release-readiness.md) for actual verification status and external setup requirements.

## Security and operations

Authorization is enforced in server routes and database RLS. Guests and demos use separate private tables and opaque HttpOnly cookies. Database deadlines block expired data even before scheduled deletion. Legacy documents remain in an administrator-only archive; demo names never establish account ownership.

Follow the [migration and rollback runbook](docs/deployment/cutover.md) for an existing deployment. Apply the database migrations and app as one coordinated release. Do not use the old schema scripts to disable RLS. Report security issues privately through the repository owner's GitHub profile; never post credentials or private document content in an issue.
