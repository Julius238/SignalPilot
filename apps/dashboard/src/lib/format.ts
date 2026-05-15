export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
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
