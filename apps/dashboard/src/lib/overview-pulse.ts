import { isErrorStatus, type DataStatus } from "./data-status";
import { regimeSentence } from "../components/dashboard/shared";
import type { MarketRegimeSnapshot } from "./signalpilot-api";

// Der Puls-Satz des Lagebilds auf der Übersicht.
//
// Er liegt hier und nicht in `app/dashboard/page.tsx`, weil Next.js aus einem
// Page-Modul keine zusätzlichen Exporte zulässt — und weil genau dieser Satz
// einen Regressionstest verdient: Er ist die prominenteste Aussage der ganzen
// Anwendung und hat bei ausgefallener API "Ruhige Lage — aktuell nichts
// Dringendes." behauptet.
//
// Grundregel: Eine beruhigende Aussage ist eine Tatsachenbehauptung über die
// Welt. Sie darf nur fallen, wenn die Quellen tatsächlich befragt werden konnten.

export type PulseInput = {
  criticalCount: number;
  notableCount: number;
  radarCount: number;
  topCluster: string | null;
  topRegion: string | null;
  regime: MarketRegimeSnapshot | null | undefined;
  /** Zustand der MarketEvent-Quelle. */
  eventsStatus: DataStatus;
  /** Zustand der RadarEvent-Quelle. */
  radarStatus: DataStatus;
};

export type Pulse = {
  pulse: string;
  context: string | null;
};

export function buildPulse({
  criticalCount,
  notableCount,
  radarCount,
  topCluster,
  topRegion,
  regime,
  eventsStatus,
  radarStatus
}: PulseInput): Pulse {
  const eventsBroken = isErrorStatus(eventsStatus);
  const radarBroken = isErrorStatus(radarStatus);

  if (eventsBroken && radarBroken) {
    return {
      pulse: "Lage nicht beurteilbar — es liegen gerade keine Daten vor.",
      context:
        "Weltgeschehen und Markt-Radar konnten nicht abgerufen werden. Solange das so ist, sagt diese Seite nichts über die tatsächliche Marktlage aus."
    };
  }

  let pulse: string;
  if (eventsBroken) {
    pulse = "Lage nur teilweise beurteilbar — das Weltgeschehen fehlt.";
  } else if (criticalCount > 0) {
    pulse =
      criticalCount === 1
        ? "Erhöhte Aufmerksamkeit: 1 sehr wichtiges Ereignis in den letzten 48 Stunden."
        : `Erhöhte Aufmerksamkeit: ${criticalCount} sehr wichtige Ereignisse in den letzten 48 Stunden.`;
  } else if (notableCount > 0) {
    pulse =
      notableCount === 1
        ? "Eine wichtige Entwicklung im Blick — kein akuter Alarm."
        : `${notableCount} wichtige Entwicklungen im Blick — kein akuter Alarm.`;
  } else if (radarBroken) {
    // Das Weltgeschehen ist geprüft und ruhig, das Radar fehlt — "ruhige Lage"
    // wäre trotzdem zu viel behauptet.
    pulse = "Nichts Dringendes im Weltgeschehen — das Markt-Radar fehlt.";
  } else {
    pulse = "Ruhige Lage — aktuell nichts Dringendes.";
  }

  const parts: string[] = [];
  if (eventsBroken) {
    parts.push("Das Weltgeschehen ist derzeit nicht abrufbar.");
  } else if (topCluster) {
    parts.push(
      topRegion
        ? `Die meisten Meldungen drehen sich um ${topCluster} — häufigste Region: ${topRegion}.`
        : `Die meisten Meldungen drehen sich um ${topCluster}.`
    );
  }

  if (radarBroken) {
    parts.push("Das Markt-Radar ist derzeit nicht abrufbar.");
  } else {
    parts.push(
      radarCount > 0
        ? radarCount === 1
          ? "Das Markt-Radar meldet eine Beobachtung."
          : `Das Markt-Radar meldet ${radarCount} Beobachtungen.`
        : "Das Markt-Radar ist ruhig."
    );
  }

  if (eventsStatus === "stale" && !eventsBroken) {
    parts.push("Die jüngste Meldung liegt allerdings außerhalb des Zeitfensters.");
  }

  const regimePart = regimeSentence(regime?.overallRegime);
  if (regimePart) parts.push(regimePart);

  return { pulse, context: parts.length > 0 ? parts.join(" ") : null };
}
