import { NextResponse } from "next/server";
import { getStorageHealth } from "@/lib/server/guild-store";
import type { GuildStorageHealth } from "@/lib/guild-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const health: GuildStorageHealth = getStorageHealth();
  return NextResponse.json(health);
}
