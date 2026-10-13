#!/usr/bin/env bash
# Fasst die TAP-Ausgabe von `pnpm -r test` pro Paket zusammen.
#
#   scripts/ci/test-summary.sh test-output.log
#
# Gibt eine Markdown-Tabelle aus (Paket, Tests, bestanden, fehlgeschlagen,
# übersprungen) und endet mit Exit 1, wenn ein Test fehlschlug oder gar
# keine Ergebnisse gefunden wurden.
set -euo pipefail

log="${1:?Pfad zur Testausgabe fehlt}"

awk '
  match($0, /^[^ ]+ test: # (tests|pass|fail|skipped) [0-9]+$/) {
    pkg = $1
    key = $4
    value = $5
    if (!(pkg in seen)) { seen[pkg] = 1; order[++n] = pkg }
    count[pkg, key] = value
    total[key] += value
  }
  END {
    print "| Paket | Tests | bestanden | fehlgeschlagen | übersprungen |"
    print "|---|---:|---:|---:|---:|"
    for (i = 1; i <= n; i++) {
      p = order[i]
      printf "| %s | %d | %d | %d | %d |\n", p, count[p, "tests"], count[p, "pass"], count[p, "fail"], count[p, "skipped"]
    }
    printf "| **Summe (%d Pakete)** | **%d** | **%d** | **%d** | **%d** |\n", n, total["tests"], total["pass"], total["fail"], total["skipped"]
    if (n == 0 || total["tests"] == 0 || total["fail"] > 0) exit 1
  }
' "$log"
