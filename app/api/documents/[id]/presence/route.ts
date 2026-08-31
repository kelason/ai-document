import { NextRequest, NextResponse } from "next/server";

interface PresenceData {
  userId: string;
  name: string;
  avatar: string;
  color: string;
  cursorOffset?: number;
  lastActive: number;
}

// Store presence registry in globalThis to persist across hot reloads in dev
const globalPresence = globalThis as unknown as {
  presenceRegistry?: Record<string, Record<string, PresenceData>>;
};

if (!globalPresence.presenceRegistry) {
  globalPresence.presenceRegistry = {};
}

const presenceRegistry = globalPresence.presenceRegistry;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/documents/[id]/presence
// Updates current user's presence and returns other active users on the document
export async function POST(request: NextRequest, props: RouteParams) {
  const { id: docId } = await props.params;

  try {
    const body = await request.json();
    const { userId, name, avatar, color, cursorOffset, active } = body;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (!presenceRegistry[docId]) {
      presenceRegistry[docId] = {};
    }

    const now = Date.now();

    if (active === false) {
      // Remove user if they explicitly leave
      delete presenceRegistry[docId][userId];
    } else {
      // Add/Update user details
      presenceRegistry[docId][userId] = {
        userId,
        name: name || "Anonymous",
        avatar: avatar || "?",
        color: color || "#71717a",
        cursorOffset,
        lastActive: now,
      };
    }

    // Clean up inactive users (no update for > 4 seconds)
    const activeUsers: PresenceData[] = [];
    const threshold = now - 4000;

    for (const [uId, uData] of Object.entries(presenceRegistry[docId])) {
      if (uData.lastActive > threshold) {
        if (uId !== userId) {
          activeUsers.push(uData);
        }
      } else {
        // Remove expired user
        delete presenceRegistry[docId][uId];
      }
    }

    return NextResponse.json({ activeUsers });
  } catch (error) {
    console.error("Failed to update presence:", error);
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
