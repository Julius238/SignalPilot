export default function TradingLoading() {
  return (
    <>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Shadow Trading</span>
          <h1>Lädt…</h1>
        </div>
      </div>
      <div className="skeleton-block" style={{ height: 136 }} />
      <div className="skeleton-block" style={{ height: 320 }} />
    </>
  );
}
