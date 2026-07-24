export default function ScannerLoading() {
  return (
    <>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Beobachten</span>
          <h1>Markt-Radar</h1>
          <p>Beobachtungen werden nach Relevanz geordnet.</p>
        </div>
      </div>
      <div className="skeleton-block" style={{ height: 136 }} />
      <div className="skeleton-block" style={{ height: 320 }} />
    </>
  );
}
