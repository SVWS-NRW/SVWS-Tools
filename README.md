# SVWS-Tools

Bündelt die Web-Apps der SVWS-Tools zu einem ZIP-Paket `svws-tools.zip`, das der Installer des SVWS-Servers über das latest Release dieses Repositorys bezieht:

```
https://github.com/SVWS-NRW/SVWS-Tools/releases/latest/download/svws-tools.zip
```

Hintergrund und Entscheidungen: [docs/adr/adr001-svws-tools-deployment.md](docs/adr/adr001-svws-tools-deployment.md)

## Paketstruktur

```
tools/
├── start/          Startseite (aus src/start) mit Vorlage sichtbarkeit.example.js
├── konferenz/      SVWS-Conference
├── import/         SVWS-Import
├── prognos/        SVWS-Prognos
├── gradehub/       SVWS-GradeHub
├── laufbahn/       SVWS-Laufbahnplanung (aus dem SVWS-Server-Release)
└── versions.json   Paketversion und enthaltene Tool-Versionen
```

Jedes Tool liegt mit seiner `index.html` direkt in `tools/<name>/`. Die Ordnernamen sind verbindlich.

## Kacheln auf der Startseite ein- und ausblenden

Der IT-Dienstleister entscheidet, welche Kacheln in der Schule auf der Startseite erscheinen. Dazu kopiert er auf dem Server im Ordner der Startseite die Vorlage `start/sichtbarkeit.example.js` nach `start/sichtbarkeit.js` und setzt die gewünschten Kacheln auf `false`:

```js
window.SVWS_TOOLS_SICHTBARKEIT = {
  "client": true,
  "admin": false,
  "dokumentation": true,
  "konferenz": true,
  "gradehub": true,
  "import": true,
  "laufbahn": true,
  "prognos": false,
  "openapi": false
};
```

- Nur `false` blendet aus. Fehlt ein Eintrag oder die ganze Datei, bleibt die Kachel sichtbar.
- Ausgeblendete Tools bleiben installiert und sind über ihre URL weiter erreichbar.
- **SVWS-Server neu starten, wenn die Datei neu angelegt wurde.** Der Server ermittelt die Dateien unter `/app/` nur beim Start. Spätere Änderungen an einer vorhandenen `sichtbarkeit.js` wirken dagegen sofort.
- `sichtbarkeit.js` ist nicht im Paket enthalten und wird deshalb bei einem Update nicht überschrieben. Der Installer darf beim Update nur die mitgelieferten Dateien ersetzen und nicht den Ordner `start/` komplett löschen.

Warum JavaScript und nicht JSON: Der SVWS-Server liefert unter `/app/` nur Dateien in einem App-Ordner und nur bestimmte Typen aus (`.html`, `.js`, `.css`, Bilder, Schriften), aber kein `.json`.

Die Namen der Kacheln stehen im Attribut `data-tool` der Startseite [src/start/index.html](src/start/index.html). Der Build erzeugt die Vorlage daraus automatisch.

## Tools verwalten

Alle Tools stehen in [tools.json](tools.json):

```json
{
  "name": "import",
  "title": "SVWS-Import",
  "repo": "SVWS-NRW/SVWS-Import",
  "asset": "SVWS-Import-{version}-webapp.zip",
  "version": null
}
```

| Feld | Bedeutung |
|---|---|
| `name` | Zielordner unter `tools/` (a-z, 0-9, `-`) |
| `title` | Anzeigename für Release-Notes und `versions.json` |
| `repo` | GitHub-Repository des Tools |
| `asset` | Dateiname des Web-App-ZIPs im Release, `{version}` = Version ohne führendes `v` |
| `version` | `null` = latest Release, sonst feste Version ohne führendes `v`, z. B. `"0.3.3"` (Release-Tag `v0.3.3`) |
| `path` | nur für Inhalte aus diesem Repository, z. B. `"src/start"` |
| `patches` | optional: Textstellen in ausgelieferten Dateien ersetzen, siehe unten |

**Neues Tool aufnehmen:** Eintrag in `tools.json` ergänzen und auf der Startseite [src/start/index.html](src/start/index.html) eine Kachel mit `href="../<name>"` und `data-tool="<name>"` anlegen. Fehlt die Kachel, warnt der Build.

**Dateien eines Tools anpassen:** Mit `patches` ersetzt der Build nach dem Entpacken einzelne Textstellen, z. B. um in GradeHub den Adminbereich standardmäßig einzuschalten:

```json
"patches": [
  { "file": "config.js", "search": "// admintoolVisible: true,", "replace": "admintoolVisible: true," }
]
```

Ersetzt wird das erste Vorkommen. Fehlt die Datei oder die gesuchte Stelle, z. B. weil eine neue Tool-Version die Datei geändert hat, bricht der Build ab.

**Fehlerhaftes Tool-Release überspringen:** `version` von `null` auf die letzte funktionierende Version setzen. Hatte das Asset in dieser Version einen anderen Namen, muss auch `asset` angepasst werden.

## Voraussetzungen

- Node.js ≥ 20
- `zip` und `unzip`
- für Releases: [GitHub CLI](https://cli.github.com/) (`gh auth login`)

Der Build braucht keine GitHub-API und unterliegt daher keinem API-Limit: Das aktuelle Release ermittelt er über die Weiterleitung von `https://github.com/<repo>/releases/latest`, die ZIPs lädt er über die öffentlichen Download-Links.

## Bauen

```bash
npm run build
```

Erzeugt `release/svws-tools.zip` und `release/RELEASE_NOTES.md`. Zwischenstände liegen in `build/`. Heruntergeladene ZIPs bleiben in `.cache/downloads/` und werden wiederverwendet, solange sich die Version nicht ändert. Den Cache leeren mit `rm -rf .cache`. Fehlt ein Asset oder ist eine `index.html` nicht vorhanden, bricht der Build ab.

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
