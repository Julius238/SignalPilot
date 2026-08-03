// Build-Time-Feature-Flag für den gesamten Shadow-Trading-Dashboardbereich.
// NEXT_PUBLIC_-Variablen werden von Next.js sowohl in Server- als auch in
// Client-Bundles zur Build-Zeit eingesetzt — dieselbe Konstante ist daher in
// Server Components (Seiten) und Client Components (Nav, Operationsformulare)
// gleichermaßen gültig, ohne einen Request auszulösen.
export const TRADING_DASHBOARD_ENABLED =
  process.env.NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED === "true";
