export function DebugJsonBlock({
  label = "JSON",
  data,
}: {
  label?: string;
  data: unknown;
}) {
  let formatted: string;
  try {
    formatted = JSON.stringify(data, null, 2);
  } catch {
    formatted = String(data);
  }
  return (
    <details>
      <summary>{label}</summary>
      <pre>{formatted}</pre>
    </details>
  );
}
