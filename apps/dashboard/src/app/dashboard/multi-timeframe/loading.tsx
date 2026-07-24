export default function MultiTimeframeLoading() {
  return (
    <>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Kontext</span>
          <h1>Zeitebenen</h1>
          <p>Kurz- und langfristige Beobachtungen werden zusammengeführt.</p>
        </div>
      </div>
      <div className="skeleton-block" style={{ height: 112 }} />
      <div className="skeleton-block" style={{ height: 340 }} />
    </>
  );
}
