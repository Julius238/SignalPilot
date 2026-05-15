import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { fetchApi, type Asset } from "../../../lib/signalpilot-api";

export default async function AssetsPage() {
  const assets = await fetchApi<Asset[]>("/assets?limit=500");

  return (
    <>
      <div className="page-header">
        <h1>Assets</h1>
        <p>Seeded watchlist assets across stocks, ETFs and crypto.</p>
      </div>

      {assets.error ? <ErrorState title="Could not load assets" message={assets.error} /> : null}

      {assets.data && assets.data.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Type</th>
                <th>Exchange</th>
                <th>Base</th>
                <th>Quote</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {assets.data.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <Link href={`/dashboard/assets/${asset.symbol}`}>{asset.symbol}</Link>
                  </td>
                  <td>{asset.name}</td>
                  <td>{asset.assetType}</td>
                  <td>{asset.exchange}</td>
                  <td>{asset.baseCurrency ?? "-"}</td>
                  <td>{asset.quoteCurrency ?? "-"}</td>
                  <td>{asset.isActive ? "true" : "false"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Keine Assets gefunden." />
      )}
    </>
  );
}
