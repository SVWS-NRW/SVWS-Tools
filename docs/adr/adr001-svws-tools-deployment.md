# ADR 001: Gebündeltes Deployment der SVWS-Tools als Release-ZIP

- **Status:** Angenommen
- **Datum:** 2026-10-14, aktualisiert 2026-10-15
- **Autor:** Frank Pfotenhauer

## Kontext

Rund um den SVWS-Server gibt es mehrere eigenständige Web-Anwendungen („SVWS-Tools“), die jeweils in einem eigenen Repository entwickelt und über GitHub-Releases veröffentlicht werden (siehe [docs/index.md](../index.md)):

| Tool | Quelle (latest Release) | Asset-Muster | Zielordner im Paket |
|---|---|---|---|
| Konferenz | `SVWS-NRW/SVWS-Conference` | `svws-conference-<version>-webserver.zip` | `tools/konferenz/` |
| Import | `SVWS-NRW/SVWS-Import` | `SVWS-Import-<version>-webapp.zip` | `tools/import/` |
| Prognos | `SVWS-NRW/SVWS-Prognos` | `SVWS-Prognos-<version>-webserver.zip` | `tools/prognos/` |
| GradeHub | `SVWS-NRW/SVWS-GradeHub` | `gradehub-<version>-webserver.zip` | `tools/gradehub/` |
| Laufbahnplanung | `SVWS-NRW/SVWS-Server` | `SVWS-Laufbahnplanung-<version>.zip` | `tools/laufbahn/` |
| Startseite | dieses Repository | – | `tools/start/` |

Stand 2026-10-14 liefern alle Quell-ZIPs ihre Web-App flach aus (`index.html` und `assets/` direkt im Root, kein Wrapper-Verzeichnis).

Der Installer des SVWS-Servers soll diese Tools mit ausliefern. Ohne zentrale Bündelung müsste er jedes Tool einzeln kennen, die Release-Quelle und das Asset-Namensmuster pflegen und bei jedem neuen Tool angepasst werden.

Als Vorlage für das gewünschte Ergebnis diente ein von Hand zusammengestelltes `svws-tools.zip`.

## Ziele

1. **Ein Paket, eine Bezugsquelle:** Dieses Repository erzeugt ein ZIP `svws-tools.zip`, das alle SVWS-Tools enthält, und veröffentlicht es als GitHub-Release.
2. **Stabile Latest-URL für den Installer:** Der SVWS-Server-Installer holt das Paket über eine feste URL ohne Versionsnummer, z. B.
   `https://github.com/SVWS-NRW/SVWS-Tools/releases/latest/download/svws-tools.zip`,
   und packt es in seinen Installer. Er muss die einzelnen Tools nicht kennen.
3. **Immer die aktuellen Tool-Versionen:** Für jedes Tool wird standardmäßig das Web-App-ZIP aus dem jeweils neuesten (latest) Release seines Quell-Repositorys verwendet. Bei Bedarf kann pro Tool eine feste Version eingetragen werden.
4. **Flexibel erweiterbar:** Die Tools werden deklarativ in einer zentralen Konfigurationsdatei beschrieben (Name, Quell-Repository, Asset-Muster, Zielordner). Ein neues Tool aufzunehmen heißt, einen Eintrag hinzuzufügen, nicht den Build-Code zu ändern.
5. **Feste Paketstruktur:** Jedes Tool liegt unter `tools/<name>/`, mit `index.html` direkt in diesem Ordner. Diese Struktur ist der Vertrag zum Installer und zum SVWS-Server.
6. **Nachvollziehbarkeit:** Jedes Release dokumentiert, welche Version jedes Tools enthalten ist (z. B. in einer `tools/versions.json` im ZIP und in den Release-Notes).
7. **Sauberer Build:** Der Build läuft in einem leeren Arbeitsverzeichnis. Dateien älterer Tool-Versionen dürfen nicht im Paket landen.
8. **Robustheit:** Fehlt ein erwartetes Asset oder ist ein ZIP ungültig, bricht der Build mit einer klaren Meldung ab, statt ein unvollständiges Paket zu veröffentlichen.

## Entscheidung

### Konfiguration

Die Datei [tools.json](../../tools.json) listet alle Tools. Ein Eintrag hat diese Felder:

| Feld | Bedeutung |
|---|---|
| `name` | Zielordner unter `tools/` (verbindlich, siehe unten) |
| `title` | Anzeigename für Release-Notes und `versions.json` |
| `repo` | GitHub-Repository, z. B. `SVWS-NRW/SVWS-Import` |
| `asset` | Dateiname des Web-App-ZIPs im Release, `{version}` steht für die Versionsnummer ohne führendes `v` |
| `version` | optional: feste Version statt latest (Release-Tag `v<version>`) |
| `path` | nur für Inhalte aus diesem Repository: Quellordner, z. B. `src/start` (dann entfallen `repo` und `asset`) |

### Ordnernamen

Die Zielordner unter `tools/` sind verbindlich: `konferenz`, `import`, `prognos`, `gradehub`, `laufbahn`, `start`.

### Startseite

Die Startseite liegt unter [src/start/](../../src/start/) und wird in diesem Repository gepflegt. Sie verlinkt die Tools relativ über ihre Zielordner (z. B. `../konferenz`).

### Build

`npm run build` ([scripts/build.mjs](../../scripts/build.mjs)):

1. leert `build/` und entfernt alte Ausgaben in `release/`,
2. ermittelt pro Tool über die GitHub-API das latest Release (oder das Release zur festen Version),
3. lädt das passende Asset und entpackt es nach `build/svws-tools/tools/<name>/` bzw. kopiert den lokalen Ordner,
4. prüft, dass in jedem Zielordner eine `index.html` liegt,
5. schreibt `tools/versions.json` mit Paketversion und Tool-Versionen,
6. erzeugt `release/svws-tools.zip` und `release/RELEASE_NOTES.md`.

Jeder Fehler bricht den Build ab.

### Versionierung

Das Paket hat eine eigene SemVer-Version in `package.json`, unabhängig von den Tool-Versionen. Die erste veröffentlichte Version ist `0.1.0`. Das Release-Tag lautet `v<version>`.

### Release

Das Release wird lokal in diesem Repository angestoßen, wie im Projekt SVWS-Import:

```bash
npm run release [patch|minor|major|<x.y.z>]
```

[scripts/release.mjs](../../scripts/release.mjs) erhöht die Version (Commit und Tag), baut das Paket, pusht Commit und Tag und legt mit der GitHub CLI einen Release-Entwurf mit `svws-tools.zip` an. Erst wenn der Entwurf auf GitHub veröffentlicht ist, liefert die Latest-URL das neue Paket aus.

### Inhalt der Tools

Die Web-App-ZIPs werden unverändert übernommen. Konfigurations- und Impressumsdateien (`config.js`, `impressum.example.js`) bleiben, wie sie sind. Anpassen können sie der Installer oder der SVWS-Server.

### Kompatibilität

Das Paket gibt keine Mindestversion des SVWS-Servers an.

## Konsequenzen

**Positiv**
- Der SVWS-Server-Installer braucht nur noch eine URL.
- Neue Tools lassen sich per Konfigurationseintrag aufnehmen.
- Tool-Releases und Server-Releases sind entkoppelt.
- Ein fehlerhaftes Tool-Release lässt sich per fester Version überspringen.

**Negativ / Risiken**
- Abhängigkeit von den Asset-Namenskonventionen der Quell-Repositories: Benennt ein Tool sein Asset um, muss die Konfiguration angepasst werden. Der Build schlägt dann aber sichtbar fehl (siehe Ziel 8).
- „Latest“ eines Quell-Repositorys wird ungeprüft übernommen, solange keine feste Version eingetragen ist.
- Die Laufbahnplanung hängt am Release-Zyklus des SVWS-Servers.
- Für das Release werden lokal Node.js, `zip`, `unzip` und eine angemeldete GitHub CLI (`gh`) benötigt.

## Geklärte Fragen

- **Versionierung (2026-10-14):** Eigene SemVer-Version, festgelegt in diesem Repository, Start bei `0.1.0`.
- **Ordnername Konferenz (2026-10-14):** `konferenz` ist verbindlich. Der Link auf der Startseite wurde von `../conference` auf `../konferenz` korrigiert.
- **Startseite (2026-10-14):** Wird in diesem Repository gepflegt, Ablage unter `src/start/` (2026-10-15).
- **Auslöser für Releases (2026-10-15):** Manuell per `npm run release`, wie im Projekt SVWS-Import.
- **Feste Versionen (2026-10-15):** Optionales Feld `version` pro Tool, ohne Angabe gilt latest.
- **Konfigurations- und Impressumsdateien (2026-10-15):** Werden unverändert mitgeliefert.
- **Mindestversion SVWS-Server (2026-10-15):** Vorerst keine.
