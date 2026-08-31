# Antigravity Docs

A modern, responsive document editor and workspace built with Next.js, React, and Supabase.

**Live Demo**: [http://ai-document-black.vercel.app/documents/90al206vf](http://ai-document-black.vercel.app/documents/90al206vf)

## Features

- **Rich Text Editor**: Create and edit documents with ease.
- **File Uploads**: Import content from `.txt`, `.md`, and `.docx` files.
- **Document Sharing**: Share documents with other users with view or edit permissions.
- **Auto-Saving & Version History**: Changes are saved automatically, with built-in version history.
- **Supabase Integration**: Data is securely stored using Supabase (with an in-memory fallback for local development).
- **Automated Testing**: Playwright E2E tests integrated for Vercel via GitHub Actions.

## Prerequisites

- Node.js (v18 or higher recommended)
- A [Supabase](https://supabase.com/) account and project (required for production/Vercel deployments)

## Setup Instructions

### 1. Clone and Install

```bash
git clone <repository-url>
cd ai-assesment
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory and add your Supabase credentials. This step is **required** if you plan to deploy to Vercel.

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Setup Supabase Database

Go to your Supabase project's SQL Editor and run the following queries to create the necessary tables and disable RLS (Row Level Security):

```sql
-- Create Documents Table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Document History Table
CREATE TABLE IF NOT EXISTS document_history (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Sharing Table
CREATE TABLE IF NOT EXISTS document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,                     
  permission TEXT NOT NULL CHECK (permission IN ('view','edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Attachments Table
CREATE TABLE IF NOT EXISTS document_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Disable Row Level Security (RLS) for API Access
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_shares DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_attachments DISABLE ROW LEVEL SECURITY;
```

### 4. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Testing

This project uses [Playwright](https://playwright.dev/) for end-to-end testing.

To run the automated test suite locally:

```bash
npm run test:e2e
```

When you push code to GitHub, GitHub Actions will automatically run the Playwright test suite against your code.

## Deployment on Vercel

1. Push your code to a GitHub repository.
2. Import the repository in [Vercel](https://vercel.com/).
3. **Important**: Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to your Vercel project's Environment Variables before deploying. Vercel runs in a serverless environment and relies completely on Supabase for persistent data storage.
