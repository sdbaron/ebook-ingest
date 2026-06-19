# @tagesberichte/ebook-ingest

**ebook-ingest** ist ein Tool zum Importieren von EPUB-Dateien in eine [Obsidian](https://obsidian.md/)-Wissensdatenbank. Es extrahiert Kapitel aus einem EPUB, analysiert sie mit einem lokalen LLM (Ollama) und schreibt strukturierte Notizen in einen Obsidian-Vault — inklusive Kapitelzusammenfassungen, Konzeptextraktion, Verknüpfungen und einem globalen Map of Content (MOC).

## Features

- **EPUB-Extraktion** – Extrahiert rohen Text aus EPUB-Dateien, Kapitel für Kapitel.
- **LLM-Analyse** – Nutzt ein lokales Ollama-Modell zur Analyse jedes Kapitels:
  - Titel
  - Zusammenfassung (2–3 Sätze)
  - Extraktion von Schlüsselkonzepten mit Beschreibungen
- **Obsidian-Export** – Schreibt strukturierte Markdown-Dateien:
  - Kapitelnotizen mit YAML-Frontmatter, Zusammenfassung und Konzept-Links (`[[wikilinks]]`)
  - Konzeptnotizen mit Definitionen und Rückverweisen auf Bücher
  - Buchindex mit Kapitel- und Konzeptübersicht
  - Globalen Map of Content (MOC)
- **Registrierung** – JSON-basierte Registries für Bücher und Konzepte zur Nachverfolgung
- **Resume-Modus** – Überspringt bereits verarbeitete Kapitel bei erneuter Ausführung
- **Konzept-Normalisierung** – Bereinigt Konzeptnamen für die Verwendung als Dateinamen und Wikilinks

## Voraussetzungen

- [Node.js](https://nodejs.org/) (≥ 18)
- [pnpm](https://pnpm.io/)
- [Ollama](https://ollama.ai/) mit einem heruntergeladenen Modell (z. B. `llama3.1`)

## Installation

```bash
# Repository klonen
git clone <repository-url>
cd ebook-ingest

# Abhängigkeiten installieren
pnpm install

# Projekt bauen
pnpm build
```

## Konfiguration

Die Standardkonfiguration befindet sich in `src/config.ts`:

| Option | Standardwert | Beschreibung |
|---|---|---|
| `vault` | `/Users/sergeydaub/work/barmbini/ObsidianVault` | Root-Pfad des Obsidian-Vaults |
| `booksDir` | `01_books` | Verzeichnis für Buch-Kapitelnotizen |
| `conceptsDir` | `02_concepts` | Verzeichnis für Konzeptnotizen |
| `mocDir` | `04_mocs` | Verzeichnis für Maps of Content |
| `metaDir` | `99_meta` | Verzeichnis für Metadaten/Registries |
| `conceptRegistry` | `99_meta/concept_registry.json` | Pfad zur Konzept-Registry |
| `bookRegistry` | `99_meta/books_registry.json` | Pfad zur Buch-Registry |
| `model` | `llama3.1` | Ollama-Modell für die LLM-Analyse |

Du kannst die Konfiguration überschreiben, indem du eine JSON-Konfigurationsdatei erstellst und diese mit der Option `--config` übergibst.

## Verwendung

### Entwicklung (mit Hot-Reload)

```bash
pnpm dev <epub> <buchname> [projekt] [optionen]
```

### Kompilierte Version

```bash
node dist/cli.js <epub> <buchname> [projekt] [optionen]
```

### Globaler Befehl (optional)

Nach dem Build kann `ebook-ingest` global verfügbar gemacht werden:

```bash
pnpm link --global
```

Danach ist der Befehl systemweit nutzbar:

```bash
ebook-ingest <epub> <buchname> [projekt] [optionen]
```

Zum Entfernen des globalen Links:

```bash
pnpm uninstall --global @tagesberichte/ebook-ingest
```

### Argumente

| Argument | Beschreibung |
|---|---|
| `<epub>` | Pfad zur EPUB-Datei |
| `<buchname>` | Name des Buches (wird als Verzeichnis- und Dateiname verwendet) |
| `[projekt]` | Projektzuordnung (Standard: `General`) |
| `--resume`, `-r` | Überspringe bereits verarbeitete Kapitel |
| `--config <pfad>` | Pfad zu einer JSON-Konfigurationsdatei |

### Beispiele

```bash
# Ein Buch mit Standardkonfiguration importieren
pnpm dev ./mein-buch.epub "Clean Code"

# Mit Projektzuordnung und Resume-Modus
pnpm dev ./buch.epub "Domain-Driven Design" "Software Engineering" --resume

# Mit benutzerdefinierter Konfiguration
pnpm dev ./buch.epub "Refactoring" --config ./my-config.json
```

## Tests

```bash
# Tests ausführen
pnpm test

# Tests im Watch-Modus
pnpm test:watch
```

## Projektstruktur

```
src/
├── cli.ts                # CLI-Einstiegspunkt
├── config.ts             # Konfiguration und Standardwerte
├── concept-normalizer.ts # Normalisiert Konzeptnamen für Dateinamen
├── epub-extractor.ts     # Extrahiert Text aus EPUB-Dateien
├── index.ts              # Öffentliches API-Modul
├── knowledge-store.ts    # Verwaltet Konzept- und Buch-Registries
├── llm-analyzer.ts       # LLM-gestützte Kapitelanalyse (Ollama)
├── obsidian-writer.ts    # Schreibt Obsidian-Markdown-Dateien
├── pipeline.ts           # Haupt-Pipeline (EPUB → Analyse → Vault)
└── registry-manager.ts   # JSON-Registry-Dateiverwaltung
```

## Ablauf der Pipeline

1. **Initialisierung** – Meta-Verzeichnis und Registry-Dateien werden angelegt.
2. **EPUB-Extraktion** – Die EPUB-Datei wird gelesen und in einzelne Kapitel aufgeteilt (Kapitel mit weniger als 500 Zeichen werden gefiltert).
3. **LLM-Analyse** – Jedes Kapitel wird an ein lokales Ollama-Modell gesendet, das Titel, Zusammenfassung und Konzepte extrahiert.
4. **Obsidian-Export** – Für jedes Kapitel wird eine Markdown-Datei geschrieben. Konzeptnotizen werden erstellt oder aktualisiert.
5. **Indizierung** – Ein Buchindex und der globale Map of Content werden generiert.
6. **Registrierung** – Alle Konzepte und Bücher werden in JSON-Registries nachverfolgt.

## Lizenz

Privat / Intern – @tagesberichte
