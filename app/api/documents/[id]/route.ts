import { NextRequest, NextResponse } from "next/server";
import { getDocumentById, updateDocument, deleteDocument, restoreVersion } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/documents/[id]
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const doc = await getDocumentById(id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json(doc);
}

// PATCH /api/documents/[id]
export async function PATCH(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  try {
    const body = await request.json();
    const { title, content, updatedBy, restoreVersionId, createVersion } = body;

    let doc;
    if (restoreVersionId) {
      doc = await restoreVersion(id, restoreVersionId, updatedBy || "Anonymous");
    } else {
      doc = await updateDocument(id, {
        title,
        content,
        updatedBy,
        createVersion,
      });
    }

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json(doc);
  } catch (error) {
    console.error("Failed to update document:", error);
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}

// DELETE /api/documents/[id]
export async function DELETE(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const success = await deleteDocument(id);
  if (!success) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
