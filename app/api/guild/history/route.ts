import { NextResponse } from "next/server";
import { getHistory, HistoryQueryError } from "@/lib/server/guild-store";
import type { HistoryQuery } from "@/lib/guild-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set<NonNullable<HistoryQuery["status"]>>(["active", "completed", "interrupted", "stalled"]);

function optional(params: URLSearchParams, name: string, maxLength: number) {
  const value = params.get(name);
  if (value === null || value === "") return undefined;
  if (value.length > maxLength) throw new Error(`Invalid ${name}.`);
  return value;
}

function date(params: URLSearchParams, name: string) {
  const value = optional(params, name, 40);
  if (!value) return undefined;
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${name}.`);
  return new Date(value).toISOString();
}

function cursor(params: URLSearchParams) {
  const encoded = optional(params, "cursor", 400);
  if (!encoded) return undefined;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
    if (typeof value.updatedAt !== "string" || typeof value.id !== "string" || value.id.length > 180 || Number.isNaN(Date.parse(value.updatedAt))) throw new Error("invalid");
    return { updatedAt: new Date(value.updatedAt).toISOString(), id: value.id };
  } catch {
    throw new Error("Invalid cursor.");
  }
}

function parseQuery(params: URLSearchParams): HistoryQuery {
  const rawLimit = optional(params, "limit", 3);
  const limit = rawLimit === undefined ? 25 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit.");
  const status = optional(params, "status", 16) as HistoryQuery["status"];
  if (status && !statuses.has(status)) throw new Error("Invalid status.");
  const agent = optional(params, "agent", 96);
  if (agent && !/^[a-z][a-z0-9._:-]{0,95}$/i.test(agent)) throw new Error("Invalid agent.");
  const from = date(params, "from");
  const to = date(params, "to");
  if (from && to && from > to) throw new Error("Invalid date range.");
  return {
    projectId: optional(params, "projectId", 180),
    q: optional(params, "q", 200),
    status,
    agent: agent?.toLowerCase(),
    from,
    to,
    limit,
    cursor: cursor(params),
  };
}

export function GET(request: Request) {
  try {
    const payload = getHistory(parseQuery(new URL(request.url).searchParams));
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof HistoryQueryError) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid history query." }, { status: 400 });
  }
}
