import Link from "next/link";

import { EmptyState, ErrorState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/ui";
import { fetchApi, type Asset, type AssetType } from "../../../lib/signalpilot-api";

const TYPE_LABELS: Record<AssetType, string> = {
  CRYPTO: "Krypto",
  STOCK: "Aktien",
  ETF: "ETF"
};

const TYPE_ORDER: AssetType[] = ["CRYPTO", "STOCK", "ETF"];

export default async function AssetsPage() {
  const assets = await fetchApi<Asset[]>("/assets?limit=500");
  const allAssets = assets.data ?? [];

  const activeCount = allAssets.filter((a) => a.isActive).length;

  const grouped = new Map<AssetType, Asset[]>();
  for (const type of TYPE_ORDER) grouped.set(type, []);
  for (const asset of allAssets) {
    grouped.get(asset.assetType)?.push(asset);
  }

  return (
    <>
      <PageHeader
        title="Asset-Übersicht"
        subtitle={`${allAssets.length} Assets · ${activeCount} aktiv`}
      />

      {assets.error ? (
        <ErrorState title="Assets konnten nicht geladen werden" message={assets.error} />
      ) : null}

      {allAssets.length === 0 && !assets.error ? (
        <EmptyState title="Keine Assets gefunden." />
      ) : (
        TYPE_ORDER.map((type) => {
          const list = grouped.get(type) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={type} className="cmd-section">
              <div className="section-header">
                <h2 className="section-title">{TYPE_LABELS[type]}</h2>
                <span className="scanner-count">{list.length}</span>
              </div>
              <div className="stack-list">
                {list.map((asset) => (
                  <div key={asset.id} className="list-row">
                    <div>
                      <Link
                        href={`/dashboard/assets/${encodeURIComponent(asset.symbol)}`}
                        className="watchlist-focus-symbol"
                      >
                        {asset.symbol}
                      </Link>
                      <span className="muted small" style={{ display: "block", marginTop: 2 }}>
                        {asset.name}
                        {asset.exchange ? ` · ${asset.exchange}` : ""}
                        {asset.baseCurrency
                          ? ` · ${asset.baseCurrency}/${asset.quoteCurrency}`
                          : ""}
                      </span>
                    </div>
                    {!asset.isActive ? (
                      <span className="badge muted small">Inaktiv</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
