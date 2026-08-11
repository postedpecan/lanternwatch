import { NextResponse } from "next/server";
import { recordGuildEvent } from "@/lib/server/guild-store";
import type { IncomingGuildEvent } from "@/lib/guild-contract";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as IncomingGuildEvent;
    return NextResponse.json(recordGuildEvent(body), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid guild event.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
