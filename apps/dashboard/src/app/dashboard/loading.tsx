export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Command Center lädt">
      <div className="skeleton-block" style={{ height: 56, width: "40%" }} />
      <div className="skeleton-block" style={{ height: 150 }} />
      <div className="skeleton-block" style={{ height: 220 }} />
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div className="skeleton-block" style={{ height: 320 }} />
        <div className="skeleton-block" style={{ height: 320 }} />
      </div>
    </div>
  );
}
