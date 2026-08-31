// app/api/documents/[id]/shares/route.ts
// ─────────────────────────────────────────
// Handles document sharing: list, grant, and revoke access.

import { NextRequest, NextResponse } from "next/server";
import {
  getDocumentById,
  getDocumentShares,
  shareDocument,
  unshareDocument,
} from "@/lib/db";
import { USER_PROFILES, SHARE_PERMISSIONS, API_ERROR_CODES } from "@/lib/constants";

type Params = { params: Promise<{ id: string }> };

// ── GET /api/documents/:id/shares ─────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const doc = await getDocumentById(id);
  if (!doc) {
    return NextResponse.json(
      { error: "Document not found.", code: API_ERROR_CODES.NOT_FOUND },
      { status: 404 }
    );
  }

  const shares = await getDocumentShares(id);
  return NextResponse.json(shares);
}

// ── POST /api/documents/:id/shares ────────────────────────────────────────────
// Body: { userId: string; permission: "view" | "edit" }
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let body: { userId?: string; permission?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: API_ERROR_CODES.VALIDATION_ERROR },
      { status: 400 }
    );
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { userId, permission } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json(
      { error: "userId is required.", code: API_ERROR_CODES.VALIDATION_ERROR },
      { status: 400 }
    );
  }

  const validPermissions = Object.values(SHARE_PERMISSIONS) as string[];
  if (!permission || !validPermissions.includes(permission)) {
    return NextResponse.json(
      {
        error: `permission must be one of: ${validPermissions.join(", ")}.`,
        code: API_ERROR_CODES.VALIDATION_ERROR,
      },
      { status: 400 }
    );
  }

  if (!USER_PROFILES.find((p) => p.id === userId)) {
    return NextResponse.json(
      { error: "Unknown userId — not a valid user profile.", code: API_ERROR_CODES.VALIDATION_ERROR },
      { status: 400 }
    );
  }

  // ── Business logic validation ─────────────────────────────────────────────
  const doc = await getDocumentById(id);
  if (!doc) {
    return NextResponse.json(
      { error: "Document not found.", code: API_ERROR_CODES.NOT_FOUND },
      { status: 404 }
    );
  }

  const ownerProfile = USER_PROFILES.find((p) => p.name === doc.owner);
  if (ownerProfile?.id === userId) {
    return NextResponse.json(
      { error: "Cannot share a document with its owner.", code: API_ERROR_CODES.SHARE_WITH_SELF },
      { status: 422 }
    );
  }

  const existingShares = await getDocumentShares(id);
  if (existingShares.some((s) => s.userId === userId)) {
    return NextResponse.json(
      { error: "This user already has access to the document.", code: API_ERROR_CODES.ALREADY_SHARED },
      { status: 409 }
    );
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  const newShare = await shareDocument(id, userId, permission as "view" | "edit");
  if (!newShare) {
    return NextResponse.json(
      { error: "Failed to share document. Please try again.", code: API_ERROR_CODES.SERVER_ERROR },
      { status: 500 }
    );
  }

  return NextResponse.json(newShare, { status: 201 });
}

// ── DELETE /api/documents/:id/shares/:shareId ─────────────────────────────────
// shareId is passed as the last URL segment via a nested catch-all
// But Next.js dynamic segments mean we need [shareId] to be another route.
// We handle it by accepting the shareId in the query string:
// DELETE /api/documents/:id/shares/:shareId → handled in [shareId]/route.ts
// This DELETE here is not needed; see route below.
