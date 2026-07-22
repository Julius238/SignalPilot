export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Übersicht lädt">
      <div className="skeleton-block" style={{ height: 52, width: "42%" }} />
      <div className="skeleton-block" style={{ height: 42, borderRadius: 999 }} />
      <div className="skeleton-block" style={{ height: 210 }} />
      <div className="skeleton-block" style={{ height: 96 }} />
      <div className="skeleton-block" style={{ height: 96 }} />
      <div className="skeleton-block" style={{ height: 96 }} />
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div className="skeleton-block" style={{ height: 300 }} />
        <div className="skeleton-block" style={{ height: 300 }} />
      </div>
    </div>
  );
}
