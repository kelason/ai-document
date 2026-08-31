import { NextRequest, NextResponse } from "next/server";
import { getDocuments, createDocument, seedDefaultDocuments } from "@/lib/db";

// GET /api/documents
export async function GET() {
  await seedDefaultDocuments();
  const docs = await getDocuments();
  // Return documents metadata (we can return the whole thing or slice it, returning full is fine since they are small)
  return NextResponse.json(docs);
}

// POST /api/documents
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, template, owner } = body;

    let content = "";
    let docTitle = title || "Untitled Document";

    if (template === "meeting-notes") {
      docTitle = title || "Meeting Notes - " + new Date().toLocaleDateString();
      content = `
        <h1>Meeting Notes</h1>
        <p><b>Date:</b> ${new Date().toLocaleDateString()}</p>
        <p><b>Attendees:</b> </p>
        <hr>
        <h2>Agenda</h2>
        <ol>
          <li>Status updates</li>
          <li>New feature design review</li>
          <li>Q4 planning milestones</li>
        </ol>
        <h2>Discussion Items</h2>
        <ul>
          <li><b>Item 1:</b> Discussed the design layout and decided on using a slate theme.</li>
          <li><b>Item 2:</b> Sync mechanism confirmed using hybrid BroadcastChannel and short polling presence.</li>
        </ul>
        <h2>Action Items</h2>
        <ul>
          <li>[ ] Integrate presence layout into sidebar (Alice)</li>
          <li>[ ] Set up SQLite or JSON database storage (Bob)</li>
          <li>[ ] Perform QA & end-to-end verification (Charlie)</li>
        </ul>
      `.trim();
    } else if (template === "project-proposal") {
      docTitle = title || "Project Proposal - " + new Date().toLocaleDateString();
      content = `
        <h1>Project Proposal</h1>
        <p><b>Status:</b> Draft</p>
        <p><b>Author:</b> </p>
        <hr>
        <h2>1. Executive Summary</h2>
        <p>This project aims to deliver a collaborative document editor tailored for fast-paced development teams. It enables multiple developers or project managers to write, format, and structure project requirements documents (PRDs) asynchronously or concurrently.</p>
        <h2>2. Problem Statement</h2>
        <p>Many traditional documentation tools are heavy, sluggish, and separate the user from their code workspace. A lightweight, web-native editor can bridge this gap.</p>
        <h2>3. Proposed Solution</h2>
        <p>A beautiful React + Next.js document editor with a rich formatting toolbar, document outline, real-time presence indicators, version history, and template loaders.</p>
        <h2>4. Milestones & Timeline</h2>
        <ul>
          <li><b>Milestone 1:</b> Rich text editing foundation & local file database storage.</li>
          <li><b>Milestone 2:</b> Outline generation & version history restoring.</li>
          <li><b>Milestone 3:</b> Visual collaborative presence cursors & multi-user testing.</li>
        </ul>
      `.trim();
    } else if (template === "software-spec") {
      docTitle = title || "Software Spec - " + new Date().toLocaleDateString();
      content = `
        <h1>Software Specification</h1>
        <p><b>API Revision:</b> v1.0.0</p>
        <hr>
        <h2>Architecture Overview</h2>
        <p>The system is built on Next.js 16 (App Router) and Tailwind CSS v4. Data is persisted to a JSON file system on the server. Collaborative syncing uses BroadcastChannel locally for sub-millisecond tab updates, plus presence heartbeat polling.</p>
        <h2>Database Schema</h2>
        <p>The database schema is fully defined in <code>lib/db.ts</code>:</p>
        <ul>
          <li><code>Document</code>: Core schema holding ID, title, HTML content, timestamp, owner, and version history.</li>
          <li><code>DocumentVersion</code>: Holds snapshots of previous revisions for rollback support.</li>
        </ul>
        <h2>API Routes</h2>
        <ul>
          <li><code>GET /api/documents</code>: Lists metadata for all documents.</li>
          <li><code>GET /api/documents/[id]</code>: Fetches document details, including history and active presence list.</li>
          <li><code>POST /api/documents/[id]/presence</code>: Heartbeat endpoint updating user position and returning other active cursors.</li>
        </ul>
      `.trim();
    }

    const newDoc = await createDocument(docTitle, content, owner || "Anonymous");
    return NextResponse.json(newDoc);
  } catch (error) {
    console.error("Failed to create document:", error);
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
