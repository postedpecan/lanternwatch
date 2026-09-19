import { NextResponse } from "next/server";
import { applyCatalogAction, getCatalog, type CatalogAction } from "@/lib/server/agent-catalog";
import { getCatalogDependencies } from "@/lib/server/guild-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getCatalog(getCatalogDependencies()));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as CatalogAction;
    if (!body || typeof body !== "object" || !("action" in body)) throw new Error("Invalid agent catalog action.");
    return NextResponse.json(applyCatalogAction(getCatalogDependencies(), body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent catalog request failed." }, { status: 400 });
  }
}
