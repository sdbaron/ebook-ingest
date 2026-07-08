<!-- markdownlint-disable MD024 -->

# @tagesberichte/ebook-ingest

**ebook-ingest** ist ein Tool zum Importieren von Quellen
(EPUB, PDF, FB2, HTML, URLs) in eine [Obsidian](https://obsidian.md/)-Wissensdatenbank.
Es extrahiert Text aus beliebigen Formaten, bereinigt ihn,
analysiert ihn mit einem lokalen LLM (Ollama) und schreibt strukturierte
Notizen in einen Obsidian-Vault — inklusive Zusammenfassungen,
Konzeptextraktion, Wikilinks und automatisch generierten
Maps of Content (MOCs).

## Features

### 📥 Extraktion & Preprocessing

- **Universal Extractor** – Unterstützt EPUB, PDF, FB2, HTML-Dateien und URLs über eine einheitliche Schnittstelle.
- **Text-Preprocessing** – Bereinigt Rohtext vor der LLM-Analyse:
  - Entfernt PDF-Header/Footer und Seitenzahlen
  - Filtert HTML-Boilerplate (Navigation, Cookie-Banner, Copyright)
  - Erkennt Kapitelgrenzen („Chapter 1", „1. Introduction", „IV. Methodology")
  - Qualitätsfilter: Mindestlänge, Buchstabenanteil, Wiederholungserkennung
- **Source-Modell** – Einheitliches Datenmodell für alle Quelltypen (`epub`, `pdf`, `html`, `url`, `fb2`).

### 🧠 LLM-Analyse

- Nutzt ein lokales Ollama-Modell zur Analyse jedes Textblocks:
  - Titel + Zusammenfassung (2–3 Sätze)
  - Extraktion von Schlüsselkonzepten mit Beschreibungen
- **Concept Merge Engine** – Erkennt und merged Duplikate (Normalisierung, Akronyme, LLM-Ähnlichkeit).

### 📝 Obsidian-Export

- Source-Blöcke mit YAML-Frontmatter (`type: source_block`, `source_type:`)
- Source-Index mit Block- und Konzeptübersicht (`type: source`)
- Konzeptnotizen mit Definitionen und Rückverweisen auf Quellen
- JSON-Registries für Quellen und Konzepte mit Metadaten
- **Resume-Modus** – Überspringt bereits verarbeitete Blöcke

### 🔍 Vektorsuche & Chat (RAG)

- **ChromaDB-Integration** – Embeddings für alle Textblöcke (Cosine Similarity)
- **Semantische Suche** – `search`-Befehl über den gesamten Vault
- **Chat-Interface** – RAG-Pipeline: Retrieve → Augment → Generate
- Prompt-Templates: Standard, Akademisch, Kurz (Bullet Points)
- Interaktiver Chat-Modus mit `/clear`, `/history`

### 🗂 Auto MOC Clustering

- **K-Means-Clustering** von Konzept-Embeddings
- Automatische Cluster-Anzahl (Elbow-Methode) + Silhouette-Score
- LLM-generierte Cluster-Labels
- Automatisch generierte MOC-Dateien in `04_mocs/`

### 🔧 Utilities

- **Vault-Migration** – `migrate`-Befehl für v2→v3 (Book→Source-Modell)
- **Konzept-Normalisierung** – Bereinigt Konzeptnamen für Dateinamen und Wikilinks
- **WIKI_CONTENT_STANDARD-Konformität** – Alle erzeugten Notizen
  erfüllen die Pflicht-Frontmatter-Anforderungen für `wiki-indexer`
  und MCP-Tools (`wiki_search`, `wiki_get_note`, `wiki_backlinks`)

## Voraussetzungen

- [Node.js](https://nodejs.org/) (≥ 18)
- [pnpm](https://pnpm.io/)
- [Ollama](https://ollama.ai/) mit einem heruntergeladenen Chat-Modell (z. B. `llama3.2`)
- Für Vektorsuche: [ChromaDB](https://www.trychroma.com/) (Docker oder lokale Installation via `pip install chromadb`)
- Für Embeddings: Ollama Embedding-Modell (`ollama pull nomic-embed-text`)

> **Hinweis:** Die ChromaDB-Warnung `The 'path' argument is deprecated` ist harmlos und
> wird vom `chromadb` npm-Client v3.5.0 verursacht. Die Funktionalität ist nicht
> beeinträchtigt — Embeddings werden direkt via Ollama generiert und an ChromaDB übergeben.

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
| --- | --- | --- |
| `vault` | `/Users/sergeydaub/work/barmbini/ObsidianVault` | Root-Pfad des Obsidian-Vaults |
| `sourcesDir` | `05_sources` | Verzeichnis für Source-Notizen |
| `conceptsDir` | `02_concepts` | Verzeichnis für Konzeptnotizen |
| `mocDir` | `04_mocs` | Verzeichnis für Maps of Content |
| `metaDir` | `99_meta` | Verzeichnis für Metadaten/Registries |
| `conceptRegistry` | `99_meta/concept_registry.json` | Pfad zur Konzept-Registry |
| `sourceRegistry` | `99_meta/sources_registry.json` | Pfad zur Source-Registry |
| `model` | `llama3.2:latest` | Ollama-Modell für die LLM-Analyse |
| `attachmentsDir` | `06_attachments` | Verzeichnis für extrahierte Bilder |
| `wikiStandard.enabled` | `true` | WIKI_CONTENT_STANDARD-Frontmatter aktiv |
| `wikiStandard.defaultOwner` | `unassigned` | Owner-Kürzel für alle Notizen |
| `wikiStandard.defaultDomain` | `general` | Fallback-Domain |
| `wikiStandard.blockTypeMapping` | `{ epub: book, pdf: book, … }` | SourceFormat → WikiNoteType |

> **Veraltete Optionen:** `booksDir`, `bookRegistry` existieren weiterhin als `@deprecated`-Aliase.

### Konfigurationsdatei (automatische Erkennung)

Das CLI sucht beim Start **automatisch** nach einer Konfigurationsdatei
im aktuellen Arbeitsverzeichnis (CWD) — ohne dass `--config` angegeben werden muss.

**Sucherreihenfolge (erste gefundene Datei gewinnt):**

1. `.ebook-ingestrc`
2. `.ebook-ingestrc.json`
3. `.ebook-ingest.json`
4. `ebook-ingest.config.json`

**Merge-Reihenfolge** (spätere Werte überschreiben frühere):

1. Eingebaute Standardwerte (aus `src/config.ts`)
2. Automatisch gefundene Konfigurationsdatei im CWD
3. Explizite `--config <pfad>`-Datei

**Beispiel — `.ebook-ingest.json` im Projektordner:**

```json
{
  "vault": "D:/mein-obsidian-vault",
  "model": "mistral:latest"
}
```

```bash
cd D:/mein-projekt
ebook-ingest ./buch.epub "Clean Code"
# → Konfiguration wird automatisch aus .ebook-ingest.json geladen
```

Zusätzlich kann mit `--config <pfad>` eine beliebige JSON-Datei geladen
werden, die die automatisch gefundene Konfiguration überschreibt.

## Verwendung

### Entwicklung (mit Hot-Reload)

```bash
pnpm dev <quelle> <quellenname> [projekt] [optionen]
```

### Kompilierte Version

```bash
node dist/cli.js <quelle> <quellenname> [projekt] [optionen]
```

### Argumente

| Argument | Beschreibung |
| --- | --- |
| `<quelle>` | Pfad zur Quelldatei (.epub, .pdf, .fb2, .html) oder URL |
| `<quellenname>` | Name der Quelle (wird als Verzeichnis- und Dateiname verwendet) |
| `[projekt]` | Projektzuordnung (Standard: `General`) |
| `--resume`, `-r` | Überspringe bereits verarbeitete Blöcke |
| `--config <pfad>` | Pfad zu einer JSON-Konfigurationsdatei |

### Weitere Kommandos

| Kommando | Beschreibung |
| --- | --- |
| `ebook-ingest migrate` | Vault von v2 (Book) nach v3 (Source) migrieren |
| `ebook-ingest migrate-wiki-standard` | WIKI_CONTENT_STANDARD-Frontmatter in bestehende Notizen nachtragen |
| `ebook-ingest merge-concepts` | Doppelte Konzepte finden und mergen |
| `ebook-ingest search` | Semantische Suche über indexierte Inhalte |
| `ebook-ingest ask` | Einzelfrage via RAG |
| `ebook-ingest chat` | Interaktiver RAG-Chat |
| `ebook-ingest generate-mocs` | Maps of Content automatisch generieren |

### Beispiele

```bash
# EPUB importieren
pnpm dev ./mein-buch.epub "Clean Code"

# PDF importieren
pnpm dev ./dokument.pdf "Research Paper" "Wissenschaft"

# FB2-Buch importieren
pnpm dev ./buch.fb2 "FictionBook Title"

# Webseite importieren
pnpm dev https://example.com/article "Web Article"

# Mit Resume-Modus
pnpm dev ./buch.epub "DDD" "Software Engineering" --resume

# Vault von v2 auf v3 migrieren
pnpm dev migrate --vault /pfad/zum/vault --dry-run

# Duplikate finden und mergen
pnpm dev merge-concepts --auto

# Semantische Suche
pnpm dev search "Was ist Dependency Inversion?" --top-k 5

# Frage an den Vault (RAG)
pnpm dev ask "Erkläre das Single Responsibility Principle" --style academic --show-sources

# Interaktiver Chat
pnpm dev chat --style concise

# Auto MOCs generieren
pnpm dev generate-mocs --clusters 5
```

## Tests

```bash
# Tests ausführen (159 Tests, 22 Suites)
pnpm test

# Tests im Watch-Modus
pnpm test:watch
```

## Kompatibilität mit wiki-llm-obsidian

ebook-ingest erzeugt WIKI_CONTENT_STANDARD.md-konforme Frontmatter-Blöcke,
die vom `packages/wiki-indexer` fehlerfrei indexiert werden und über MCP-Tools
(`wiki_search`, `wiki_get_note`, `wiki_backlinks`) für Copilot auffindbar sind.

**Hinweis:** Für `html`/`url`-Quellen gibt es im `WIKI_CONTENT_STANDARD.md`-Enum
noch keinen ideal passenden Wert — ebook-ingest nutzt `pattern` als
konfigurierbaren Platzhalter. Eine Enum-Erweiterung um `article`/`note`
liegt als Entscheidung beim `wiki-llm-obsidian`-Projekt.

## Projektstruktur

```text
src/
├── cli.ts                   # CLI (ingest, migrate, migrate-wiki-standard, merge-concepts, search, ask, chat, generate-mocs)
├── config.ts                # Konfiguration + Auto-Discovery + wikiStandard
├── date-utils.ts            # ISO-8601 → YYYY-MM-DD Utilities
├── source-slug.ts           # kebab-case Namens-Normalisierung
├── frontmatter-validator.ts # WIKI_CONTENT_STANDARD.md Validator
├── concept-normalizer.ts    # Normalisiert Konzeptnamen für Dateinamen
├── concept-merge-engine.ts  # Duplikaterkennung & Merging (P1)
├── epub-extractor.ts        # EPUB → Text
├── pdf-extractor.ts         # PDF → Text                (P0)
├── html-extractor.ts        # HTML/URL → Text           (P0)
├── universal-extractor.ts   # Format-agnostische Factory (P0)
├── text-preprocessor.ts     # Textbereinigung            (P1)
├── embedding-generator.ts   # Ollama Embeddings          (P2)
├── vector-store.ts          # ChromaDB Client            (P2)
├── chat-engine.ts           # RAG Chat                   (P2)
├── prompt-templates.ts      # Prompt Styles              (P2)
├── moc-generator.ts         # Auto MOC Clustering        (P3)
├── index.ts                 # Öffentliches API-Modul
├── knowledge-store.ts       # Source- + Concept-Registries
├── llm-analyzer.ts          # LLM-gestützte Analyse (Ollama)
├── migrate-vault.ts         # v2→v3 Migration            (P0)
├── migrate-wiki-standard.ts # WIKI_CONTENT_STANDARD Migration
├── obsidian-writer.ts       # Obsidian-Markdown schreiben
├── pipeline.ts              # Haupt-Pipeline
└── registry-manager.ts      # JSON-Registry-Dateiverwaltung
```

## Ablauf der Pipeline

1. **Initialisierung** – Meta-Verzeichnis und Registry-Dateien werden angelegt.
2. **Extraktion** – Die Quelle wird formatabhängig extrahiert (EPUB/PDF/HTML/URL).
3. **Preprocessing** – Rohtext wird bereinigt (Header/Footer, Boilerplate, Kapitelerkennung, Qualitätsfilter).
4. **LLM-Analyse** – Jeder Block wird an Ollama gesendet, das Titel, Zusammenfassung und Konzepte extrahiert.
5. **Obsidian-Export** – Source-Blöcke und Konzeptnotizen werden als Markdown in `05_sources/` und `02_concepts/` geschrieben.
6. **Indizierung** – Source-Index und globaler MOC werden generiert.
7. **Vektorisierung** – Embeddings werden via Ollama (`nomic-embed-text`) generiert und in ChromaDB gespeichert.
8. **Registrierung** – Quellen und Konzepte werden in JSON-Registries mit Metadaten nachverfolgt.

> **Hinweis:** Die Vektorisierung (Schritt 7) ist optional. Wenn ChromaDB nicht läuft,
> wird sie automatisch übersprungen — keine Fehler, nur ein Log-Hinweis.
> Gleiches gilt für das Ollama-Embedding-Modell: Fehlt es, wird eine Warnung ausgegeben,
> und der Ingest läuft ohne Vektoren weiter.

## Lizenz

Privat / Intern – @tagesberichte
