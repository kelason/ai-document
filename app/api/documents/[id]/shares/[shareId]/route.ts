// app/api/documents/[id]/shares/[shareId]/route.ts
// ──────────────────────────────────────────────────
// DELETE a specific share by its ID → revokes the user's access.

import { NextRequest, NextResponse } from "next/server";
import { unshareDocument } from "@/lib/db";
import { API_ERROR_CODES } from "@/lib/constants";

type Params = { params: Promise<{ id: string; shareId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, shareId } = await params;

  if (!shareId || typeof shareId !== "string") {
    return NextResponse.json(
      { error: "shareId is required.", code: API_ERROR_CODES.VALIDATION_ERROR },
      { status: 400 }
    );
  }

  const success = await unshareDocument(shareId);
  if (!success) {
    return NextResponse.json(
      { error: "Share not found or already removed.", code: API_ERROR_CODES.NOT_FOUND },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, shareId, documentId: id });
}
