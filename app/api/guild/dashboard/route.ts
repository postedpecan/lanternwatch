import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/server/guild-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  return NextResponse.json(getDashboard(searchParams.get("projectId"), searchParams.get("runId")));
}
