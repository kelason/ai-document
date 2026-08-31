import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// This endpoint migrates documents from the local JSON file into Supabase.
// Call it once via: GET /api/migrate

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }

  const cleanUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, "");
  const supabase = createClient(cleanUrl, supabaseKey);

  // Read local documents
  const dbFile = path.join(process.cwd(), "data", "documents.json");
  if (!fs.existsSync(dbFile)) {
    return NextResponse.json({ message: "No local documents.json found", migrated: 0 });
  }

  let localDocs: any[] = [];
  try {
    localDocs = JSON.parse(fs.readFileSync(dbFile, "utf-8"));
  } catch (e) {
    return NextResponse.json({ error: "Failed to parse local documents.json" }, { status: 500 });
  }

  const results = { migrated: 0, skipped: 0, errors: [] as string[] };

  for (const doc of localDocs) {
    // Check if document already exists in Supabase
    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("id", doc.id)
      .single();

    if (existing) {
      results.skipped++;
      continue;
    }

    // Insert document
    const { error: docError } = await supabase.from("documents").insert({
      id: doc.id,
      title: doc.title,
      content: doc.content || "",
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
      owner: doc.owner || "Anonymous",
    });

    if (docError) {
      results.errors.push(`Doc ${doc.id}: ${docError.message}`);
      continue;
    }

    // Insert history entries
    if (doc.history && doc.history.length > 0) {
      const historyRows = doc.history.map((h: any) => ({
        id: h.id,
        document_id: doc.id,
        title: h.title,
        content: h.content || "",
        updated_at: h.updatedAt,
        updated_by: h.updatedBy || "Unknown",
      }));

      const { error: histError } = await supabase
        .from("document_history")
        .insert(historyRows);

      if (histError) {
        results.errors.push(`History for ${doc.id}: ${histError.message}`);
      }
    }

    results.migrated++;
  }

  return NextResponse.json({
    success: true,
    message: `Migration complete. Migrated: ${results.migrated}, Skipped (already existed): ${results.skipped}`,
    ...results,
  });
}
