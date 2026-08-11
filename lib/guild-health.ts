export type HookLogStatus = "ok" | "missing" | "empty" | "malformed" | "unreadable";

export type ParsedHookLog = {
  status: Exclude<HookLogStatus, "missing" | "unreadable">;
  receiptAt: string | null;
  event: string | null;
  stage: string | null;
};

function safeText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 180)
    : null;
}

function safeTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parseLatestHookLog(raw: string): ParsedHookLog {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { status: "empty", receiptAt: null, event: null, stage: null };
  }

  let malformed = false;
  let latest: Record<string, unknown> | null = null;
  for (const line of lines) {
    try {
      const candidate = JSON.parse(line) as unknown;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        malformed = true;
        continue;
      }
      latest = candidate as Record<string, unknown>;
    } catch {
      malformed = true;
    }
  }

  if (!latest) {
    return { status: "malformed", receiptAt: null, event: null, stage: null };
  }

  return {
    status: malformed ? "malformed" : "ok",
    receiptAt: safeTimestamp(latest.receivedAt ?? latest.at ?? latest.timestamp),
    event: safeText(latest.event ?? latest.hook_event_name ?? latest.eventName),
    stage: safeText(latest.stage),
  };
}

export function ageSeconds(timestamp: string | null, now = Date.now()) {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}
