export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatRelativeTime(value: string | null | undefined, now: Date = new Date()) {
  if (!value) {
    return "-";
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const diffMs = now.getTime() - timestamp;

  if (diffMs < 0) {
    return formatDateTime(value);
  }

  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return "gerade eben";
  }

  if (diffMinutes < 60) {
    return `vor ${diffMinutes} Min.`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `vor ${diffHours} Std.`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return diffDays === 1 ? "vor 1 Tag" : `vor ${diffDays} Tagen`;
  }

  return formatDateTime(value);
}

export function formatScore(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "-";
  }

  return value.toFixed(1);
}

export function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}
