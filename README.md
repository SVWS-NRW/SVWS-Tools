# SVWS-Tools

Bündelt die Web-Apps der SVWS-Tools zu einem ZIP-Paket `svws-tools.zip`, das der Installer des SVWS-Servers über das latest Release dieses Repositorys bezieht:

```
https://github.com/SVWS-NRW/SVWS-Tools/releases/latest/download/svws-tools.zip
```

Hintergrund und Entscheidungen: [docs/adr/adr001-svws-tools-deployment.md](docs/adr/adr001-svws-tools-deployment.md)

## Paketstruktur

```
tools/
├── start/          Startseite (aus src/start)
├── konferenz/      SVWS-Conference
├── import/         SVWS-Import
├── prognos/        SVWS-Prognos
├── gradehub/       SVWS-GradeHub
├── laufbahn/       SVWS-Laufbahnplanung (aus dem SVWS-Server-Release)
└── versions.json   Paketversion und enthaltene Tool-Versionen
```

Jedes Tool liegt mit seiner `index.html` direkt in `tools/<name>/`. Die Ordnernamen sind verbindlich.

## Tools verwalten

Alle Tools stehen in [tools.json](tools.json):

```json
{
  "name": "import",
  "title": "SVWS-Import",
  "repo": "SVWS-NRW/SVWS-Import",
  "asset": "SVWS-Import-{version}-webapp.zip"
}
```

| Feld | Bedeutung |
|---|---|
| `name` | Zielordner unter `tools/` (a-z, 0-9, `-`) |
| `title` | Anzeigename für Release-Notes und `versions.json` |
| `repo` | GitHub-Repository des Tools |
| `asset` | Dateiname des Web-App-ZIPs im Release, `{version}` = Version ohne führendes `v` |
| `version` | optional: feste Version statt latest, z. B. `"0.3.3"` (Release-Tag `v0.3.3`) |
| `path` | nur für Inhalte aus diesem Repository, z. B. `"src/start"` |

**Neues Tool aufnehmen:** Eintrag in `tools.json` ergänzen und auf der Startseite [src/start/index.html](src/start/index.html) verlinken (`../<name>`).

**Fehlerhaftes Tool-Release überspringen:** `version` auf die letzte funktionierende Version setzen. Hatte das Asset in dieser Version einen anderen Namen, muss auch `asset` angepasst werden.

## Voraussetzungen

- Node.js ≥ 20
- `zip` und `unzip`
- für Releases: [GitHub CLI](https://cli.github.com/) (`gh auth login`)

Für die Abfragen an die GitHub-API wird `GITHUB_TOKEN` oder das Token der GitHub CLI verwendet, falls vorhanden. Ohne Token gilt ein Limit von 60 Anfragen pro Stunde.

## Bauen

```bash
npm run build
```

Erzeugt `release/svws-tools.zip` und `release/RELEASE_NOTES.md`. Zwischenstände liegen in `build/`. Fehlt ein Asset oder ist eine `index.html` nicht vorhanden, bricht der Build ab.

## Release erstellen

```bash
npm run release          # patch: 0.1.0 → 0.1.1
npm run release minor    # minor: 0.1.0 → 0.2.0
npm run release major    # major: 0.1.0 → 1.0.0
npm run release 0.1.0    # feste Version (z. B. für das erste Release)
```

Das Skript [scripts/release.mjs](scripts/release.mjs) führt nacheinander aus:

1. Prüfen der Voraussetzungen (sauberes Arbeitsverzeichnis, `gh` angemeldet, Upstream vorhanden)
2. `npm version …` – erhöht die Version in `package.json`, erzeugt Commit und Tag `v<version>`
3. `npm run build` – baut das Paket
4. `git push --follow-tags` – pusht Commit und Tag
5. `npm run release:github` – legt den Release-Entwurf „Release `<version>`“ mit `svws-tools.zip` und den erzeugten Release-Notes an

Anschließend auf GitHub unter **Releases** den Entwurf prüfen und mit **Publish release** veröffentlichen. Erst danach liefert die Latest-URL das neue Paket aus.

Fehlerfälle:

- **Build schlägt fehl:** Commit und Tag der Versionserhöhung werden lokal zurückgenommen.
- **Push oder Upload schlägt fehl:** Version und Dateien sind vorhanden. Nach Behebung ohne neuen Build fortsetzen:

  ```bash
  git push --follow-tags
  npm run release:github
  ```

- **Release existiert bereits:** `gh` bricht ab. Den Entwurf auf GitHub löschen und `npm run release:github` erneut ausführen.
