// Shared, framework-agnostic formatting helpers used by both the live view
// and the history view.

export function formatElapsed(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.trunc(totalSeconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const minutesSeconds = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${minutesSeconds}` : minutesSeconds;
}

export function formatMoment(value: string | null) {
  if (!value) return "Still running";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatAge(totalSeconds: number | null) {
  if (totalSeconds === null) return "never";
  if (totalSeconds < 5) return "just now";
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ago`;
  if (totalSeconds < 86400) return `${Math.floor(totalSeconds / 3600)}h ago`;
  return `${Math.floor(totalSeconds / 86400)}d ago`;
}

export function titleCase(value: string) {
  return value.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
