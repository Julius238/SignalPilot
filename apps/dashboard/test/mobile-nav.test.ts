import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function css(): Promise<string> {
  return readFile(resolve(appDir, "src/app/globals.css"), "utf8");
}

async function navSource(): Promise<string> {
  return readFile(resolve(appDir, "src/components/nav-bar.tsx"), "utf8");
}

/**
 * Der Regelblock einer Klasse innerhalb des Mobil-Media-Query.
 * `lastIndexOf`, weil `@media (max-width: 900px)` mehrfach vorkommt und die
 * Navigationsregeln im letzten Block stehen — dort gewinnen sie die Kaskade.
 */
function ruleFor(source: string, selector: string): string {
  const mobileBlock = source.slice(source.lastIndexOf("@media (max-width: 900px)"));
  const index = mobileBlock.indexOf(`${selector} {`);
  assert.ok(index > -1, `Regel ${selector} fehlt im Mobilblock`);
  return mobileBlock.slice(index, mobileBlock.indexOf("}", index));
}

describe("mobiles Menü — blickdichtes Panel", () => {
  it("nutzt eine deckende Fläche ohne Restdurchsicht", async () => {
    const source = await css();

    // Der konkrete Fehler war `background: rgba(7, 16, 25, 0.985)` — 1,5 %
    // Restdurchsicht reichten, um den Seitentext dahinter zu lesen.
    const panel = ruleFor(source, ".side-nav-panel");
    assert.match(panel, /background:\s*var\(--nav-solid\)/);
    assert.doesNotMatch(panel, /rgba\([^)]*0\.\d+\s*\)/);

    // Das Token selbst darf keinen Alphakanal haben.
    assert.match(source, /--nav-solid:\s*#[0-9a-fA-F]{6}\s*;/);
  });

  it("legt auch die Kopfzeile der Navigation deckend an", async () => {
    const top = ruleFor(await css(), ".side-nav-top");
    assert.match(top, /background:\s*var\(--nav-solid\)/);
  });
});

describe("mobiles Menü — Abdunkler", () => {
  it("definiert einen eigenen Abdunkler über dem Seiteninhalt", async () => {
    const scrim = ruleFor(await css(), ".side-nav-scrim");

    assert.match(scrim, /position:\s*fixed/);
    assert.match(scrim, /inset:\s*0/);
    assert.match(scrim, /background:\s*rgba\(/);
  });

  it("rendert ihn nur bei geöffnetem Menü und schließt bei Klick daneben", async () => {
    const source = await navSource();

    assert.match(source, /open \? \(\s*<div className="side-nav-scrim"/);
    assert.match(source, /onClick=\{close\}/);
    // Der Abdunkler ist reine Dekoration — Escape und der Umschalter tun dasselbe.
    assert.match(source, /className="side-nav-scrim" aria-hidden="true"/);
  });

  it("hebt die Navigation über den Abdunkler", async () => {
    const source = await css();
    assert.match(ruleFor(source, ".side-nav--open"), /z-index:\s*60/);
    assert.match(ruleFor(source, ".side-nav-panel"), /z-index:\s*2/);
  });
});

/**
 * Breite des Panels aus der CSS-Regel, ausgerechnet für einen Viewport.
 * `width: min(<max>px, calc(100% - <gap>px))` — `100%` ist die Breite der
 * Seitenleiste, die im Mobil-Layout dem Viewport entspricht.
 */
function panelGeometry(rule: string, viewport: number): { panel: number; scrim: number } {
  const match = rule.match(/width:\s*min\(\s*(\d+)px,\s*calc\(100% - (\d+)px\)\s*\)/);
  assert.ok(match, `Regel .side-nav-panel hat keine begrenzte Breite: ${rule}`);
  const [, maxWidth, gap] = match;
  const panel = Math.min(Number(maxWidth), viewport - Number(gap));
  return { panel, scrim: viewport - panel };
}

describe("mobiles Menü — erreichbare Außenfläche", () => {
  it("belegt bei 390 px nicht die volle Breite", async () => {
    const panel = ruleFor(await css(), ".side-nav-panel");

    // Der konkrete Fehler: `left: 0; right: 0` spannte das Panel über die volle
    // Breite. Unterhalb der Kopfzeile lag damit nirgends der Abdunkler frei und
    // "Klick außerhalb schließt" war bei 390 × 844 nicht ausführbar.
    assert.match(panel, /left:\s*0/);
    assert.match(panel, /right:\s*auto/);
    assert.doesNotMatch(panel, /right:\s*0/);

    const { panel: width, scrim } = panelGeometry(panel, 390);
    assert.ok(width < 390, `Panel deckt bei 390 px die volle Breite: ${width}px`);
    // Mindestens ein komfortables Tippziel bleibt als Außenfläche übrig.
    assert.ok(scrim >= 44, `Außenfläche bei 390 px zu schmal: ${scrim}px`);
  });

  it("bleibt bei 390 px und 768 px breit genug bedienbar", async () => {
    const panel = ruleFor(await css(), ".side-nav-panel");

    for (const [viewport, minimum] of [
      [390, 280],
      [768, 320]
    ] as const) {
      const { panel: width, scrim } = panelGeometry(panel, viewport);
      assert.ok(width >= minimum, `Panel bei ${viewport}px zu schmal: ${width}px`);
      assert.ok(scrim >= 44, `Außenfläche bei ${viewport}px zu schmal: ${scrim}px`);
    }
  });

  it("legt den Abdunkler unter das Panel, aber über den Seiteninhalt", async () => {
    const source = await css();

    // Nur so ist die freie Fläche rechts wirklich der Abdunkler und nicht der
    // Seiteninhalt — ein Klick dort schließt, statt einen Link darunter zu treffen.
    assert.match(ruleFor(source, ".side-nav-scrim"), /z-index:\s*1/);
    assert.match(ruleFor(source, ".side-nav-panel"), /z-index:\s*2/);
  });

  it("schneidet im schmaleren Panel keine Navigationslabels ab", async () => {
    // `.nav-link` ist `white-space: nowrap`. Zwei Spalten in einer 420-px-Schublade
    // reichen für Labels wie "Unternehmenstermine" nicht.
    const items = ruleFor(await css(), ".side-nav .nav-group-items");
    assert.doesNotMatch(items, /grid-template-columns:\s*repeat\(2/);
    assert.match(items, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("erzeugt keinen horizontalen Überlauf", async () => {
    const panel = ruleFor(await css(), ".side-nav-panel");

    // Die Breite rechnet aus 100 % heraus, statt etwas zu addieren.
    assert.doesNotMatch(panel, /calc\(100% \+/);
    const { panel: width } = panelGeometry(panel, 390);
    assert.ok(width <= 390, `Panel breiter als der Viewport: ${width}px`);
  });
});

describe("mobiles Menü — Tastatur und Fokus", () => {
  it("schließt bei Escape und gibt den Fokus an den Umschalter zurück", async () => {
    const source = await navSource();

    assert.match(source, /event\.key === "Escape"/);
    assert.match(source, /setOpen\(false\)/);
    assert.match(source, /toggleRef\.current\?\.focus\(\)/);
  });

  it("hält den Fokus im geöffneten Menü", async () => {
    const source = await navSource();

    assert.match(source, /event\.key !== "Tab"/);
    assert.match(source, /a\[href\], button:not\(\[disabled\]\)/);
    assert.match(source, /event\.shiftKey && active === first/);
    assert.match(source, /!event\.shiftKey && active === last/);
  });

  it("sperrt den Hintergrund gegen Scrollen", async () => {
    const source = await navSource();

    assert.match(source, /document\.body\.style\.overflow = "hidden"/);
    // Zustand wird beim Schließen wiederhergestellt, nicht hart auf "" gesetzt.
    assert.match(source, /previousOverflow/);
  });

  it("verknüpft Umschalter und Panel für Screenreader", async () => {
    const source = await navSource();

    assert.match(source, /aria-expanded=\{open\}/);
    assert.match(source, /aria-controls="hauptnavigation"/);
    assert.match(source, /id="hauptnavigation"/);
    assert.match(source, /aria-label=\{open \? "Navigation schließen" : "Navigation öffnen"\}/);
  });

  it("räumt den Listener und die Scrollsperre wieder ab", async () => {
    const source = await navSource();

    assert.match(source, /document\.removeEventListener\("keydown", onKeyDown\)/);
    assert.match(source, /document\.body\.style\.overflow = previousOverflow/);
  });
});

describe("sichtbarer Fokus", () => {
  it("behält einen Fokusring für interaktive Flächen", async () => {
    const source = await css();
    assert.match(source, /:focus-visible/);
  });
});

describe("kein horizontales Scrollen", () => {
  it("rechnet den Einzug aus der Flex-Basis heraus", async () => {
    const source = await css();

    // `flex-basis: 100%` zusammen mit `margin-left` ergibt mehr als die volle
    // Breite — die Impact-Zeile schob die Übersicht bei 390 px seitlich auf.
    const toneRules = source.match(/\.impact-entry-tone \{[^}]*\}/g) ?? [];
    assert.ok(toneRules.length > 0, "Regel .impact-entry-tone fehlt");

    for (const rule of toneRules) {
      if (!/margin-left:\s*\d+px/.test(rule)) continue;
      assert.doesNotMatch(
        rule,
        /flex-basis:\s*100%/,
        `flex-basis: 100% neben margin-left erzeugt Überlauf: ${rule}`
      );
      assert.match(rule, /flex-basis:\s*calc\(100% - \d+px\)/);
    }
  });
});

describe("Marke bleibt einzeilig", () => {
  it("beschränkt die alte Zeilenhöhe auf die frühere Kopfnavigation", async () => {
    const source = await css();

    // Ohne den `.top-nav`-Präfix blähte die Regel die Marke der Seitenleiste
    // zwischen 641 und 900 px auf drei Zeilen auf.
    assert.match(source, /\.top-nav \.brand \{\s*line-height: 60px;/);
    assert.doesNotMatch(source, /\n\s*\.brand \{\s*\n\s*line-height: 60px;/);
  });
});
