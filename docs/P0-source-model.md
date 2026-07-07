<!-- markdownlint-disable MD024 -->

# P0 – Source-Modell (statt Book-Modell)

> **Ziel:** Das Datenmodell von "Book" auf "Source" generalisieren. Bücher, PDFs, FB2-Dateien, HTML-Seiten und URLs
> werden einheitlich als `Source` behandelt. Die Verzeichnisstruktur und Registry passen sich an.

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | `05_sources/`-Verzeichnis in Config und Writer integrieren | 30 min |
| 2 | `books_registry.json` → `sources_registry.json` migrieren | 45 min |
| 3 | `KnowledgeStore` generalisieren | 30 min |
| 4 | `ObsidianWriter`-Methoden umbenennen + `05_sources/` nutzen | 1 h |
| 5 | `WikiPipeline`-Parameter umbenennen | 30 min |
| 6 | Frontmatter-Felder aktualisieren | 30 min |
| 7 | CLI-Parameter umbenennen (abwärtskompatibel) | 30 min |
| 8 | Tests aktualisieren | 1 h |
| 9 | Migration-Script für bestehende Vaults | 30 min |

Gesamt: ~5,5 Stunden

---

## Konzept

### Vorher (Book-Modell)

```text
01_books/
  Clean_Architecture/
    01.md           (type: chapter, book: Clean_Architecture)
    index.md        (type: book)
```

### Nachher (Source-Modell)

```text
05_sources/
  Clean_Architecture/   (source_type: epub)
    01.md               (type: source_block, source: Clean_Architecture)
    index.md            (type: source)
  paper.pdf/            (source_type: pdf)
    01.md
    index.md
  article_x/            (source_type: url)
    01.md
    index.md
```

### Schlüsseländerungen

| Alt | Neu |
| --- | --- |
| `01_books/` | `05_sources/` |
| `type: book` | `type: source` |
| `type: chapter` | `type: source_block` |
| `book: X` (Frontmatter) | `source: X` |
| `book_registry.json` | `sources_registry.json` |
| `books[]` (in concept) | `sources[]` |
| `registerBook()` | `registerSource()` |

---

## Aufgabe 1: `05_sources/` in Config und Writer integrieren

**Dateien:** `src/config.ts`, `src/obsidian-writer.ts`

### config.ts

1. Neues Feld `sourcesDir: string` (Default: `"05_sources"`) zum `EbookIngestConfig`-Interface hinzufügen.
2. `booksDir` **behalten** (für Abwärtskompatibilität), aber als deprecated markieren (`/** @deprecated Use sourcesDir */`).

```typescript
export interface EbookIngestConfig {
  // ...existing...
  /** @deprecated Use sourcesDir */
  booksDir: string;
  /** Directory for source notes (books, PDFs, URLs) */
  sourcesDir: string;
  // ...
}

export const defaultConfig: EbookIngestConfig = {
  // ...existing...
  booksDir: "01_books",
  sourcesDir: "05_sources",
  // ...
};
```

### obsidian-writer.ts

1. Neues privates Feld `sourcesDir` im Konstruktor.
2. Konstruktor-Parameter um `sourcesDir` erweitern.

### Akzeptanzkriterien

- [ ] `defaultConfig.sourcesDir` = `"05_sources"`
- [ ] `defaultConfig.booksDir` existiert weiterhin (deprecated)
- [ ] `ObsidianWriter` hat Zugriff auf `sourcesDir`

---

## Aufgabe 2: `books_registry.json` → `sources_registry.json` migrieren

**Datei:** `src/config.ts`

### Änderungen

1. `bookRegistry` → `sourceRegistry` (umbenennen, alter Key als deprecated).
2. Default-Pfad: `"99_meta/book_registry.json"` → `"99_meta/sources_registry.json"`.

```typescript
export interface EbookIngestConfig {
  // ...existing...
  /** @deprecated Use sourceRegistry */
  bookRegistry: string;
  /** Path to the source registry JSON file */
  sourceRegistry: string;
  // ...
}
```

### Inhalt der neuen Registry

```json
{
  "Clean_Architecture": {
    "project": "SoftwareArchitecture",
    "source_type": "epub",
    "original_path": "/path/to/Clean_Architecture.epub",
    "ingested_at": "2026-06-19T10:00:00Z"
  }
}
```

Neue Felder:
- `source_type`: `"epub" | "pdf" | "html" | "url" | "fb2"`
- `original_path`: Ursprünglicher Pfad/URL der Quelle
- `ingested_at`: ISO-8601 Zeitstempel der ersten Ingest

### Akzeptanzkriterien

- [ ] `defaultConfig.sourceRegistry` = `"99_meta/sources_registry.json"`
- [ ] Neue Registry-Felder sind definiert
- [ ] `defaultConfig.bookRegistry` existiert weiterhin (deprecated)

---

## Aufgabe 3: `KnowledgeStore` generalisieren

**Datei:** `src/knowledge-store.ts`

### Änderungen

1. `registerBook()` → `registerSource()` mit erweiterten Parametern:

```typescript
interface SourceEntry {
  project: string;
  source_type: 'epub' | 'pdf' | 'html' | 'url';
  original_path: string;
  ingested_at: string;
}

async registerSource(
  sourceName: string,
  project: string,
  sourceType: SourceEntry['source_type'],
  originalPath: string,
): Promise<void>
```

2. `ConceptEntry.books` → `ConceptEntry.sources`:

```typescript
interface ConceptEntry {
  sources: string[];  // war: books
}
```

3. `registerConcept` nutzt nun `sources` statt `books`.

4. Alte Methoden als deprecated-Wrapper behalten:

```typescript
/** @deprecated Use registerSource */
async registerBook(bookName: string, project: string): Promise<void> {
  return this.registerSource(bookName, project, 'epub', bookName);
}
```

### Akzeptanzkriterien

- [ ] `registerSource()` akzeptiert `sourceType` und `originalPath`
- [ ] Concept-Entries nutzen `sources[]` statt `books[]`
- [ ] Alte `registerBook()`-Methode existiert als deprecated-Wrapper
- [ ] Bestehende Tests laufen weiterhin

---

## Aufgabe 4: `ObsidianWriter`-Methoden umbenennen + `05_sources/` nutzen

**Datei:** `src/obsidian-writer.ts`

### Änderungen

1. **Neues Feld** `sourcesDir` im Konstruktor.
2. **Neue Methoden** (Source-zentriert):
   - `writeSourceBlock(sourceName, project, blockNum, data, sourceType)` — schreibt nach `05_sources/{name}/01.md`
   - `writeSourceIndex(sourceName, blockCount, concepts, sourceType)` — schreibt `index.md`
3. **Alte Methoden als deprecated-Wrapper:**
   - `writeChapter()` ruft `writeSourceBlock()` auf
   - `writeBookIndex()` ruft `writeSourceIndex()` auf
4. **Frontmatter-Update** in den neuen Methoden:
   ```yaml
   ---
   type: source_block
   source: Clean_Architecture
   source_type: epub
   project: SoftwareArchitecture
   ---
   ```
5. **`updateConcept()`** nutzt `sources` statt `books` im Mentioned-in-Abschnitt.

### Hinweise

- Die `writeChapter`- und `writeBookIndex`-Methoden sollen **nicht gelöscht**
  werden — sie rufen einfach die neuen Methoden auf.
  So bleiben bestehende Aufrufe kompatibel.
- Neue Methoden schreiben nach `05_sources/`, alte nach `01_books/`. Das erlaubt eine sanfte Migration.

### Akzeptanzkriterien

- [ ] `writeSourceBlock` schreibt nach `05_sources/{name}/`
- [ ] `writeSourceIndex` schreibt `index.md` mit `type: source`
- [ ] Frontmatter enthält `source_type`
- [ ] `writeChapter` und `writeBookIndex` funktionieren weiterhin (deprecated)

---

## Aufgabe 5: `WikiPipeline`-Parameter umbenennen

**Datei:** `src/pipeline.ts`

### Änderungen

1. `ingest(epubPath, bookName, project)` → `ingest(sourcePath, sourceName, project, sourceType?)`
2. `sourceType` ist optional; wenn nicht angegeben, wird er vom `UniversalExtractor.detectFormat()` abgeleitet.
3. Interne Variablen umbenennen:
   - `bookName` → `sourceName`
   - `bookRegPath` → `sourceRegPath`
   - `book_dir` → `source_dir`
4. `writeChapter` → `writeSourceBlock`, `writeBookIndex` → `writeSourceIndex` (neue Methoden nutzen).
5. `registerBook` → `registerSource`.

### Abwärtskompatibilität

Die alte Signatur `ingest(epubPath, bookName, project)` soll weiterhin funktionieren (sourceType wird dann als `'epub'` angenommen).

```typescript
async ingest(
  sourcePath: string,
  sourceName: string,
  project: string = 'General',
  sourceType?: 'epub' | 'pdf' | 'html' | 'url',
): Promise<void>
```

### Akzeptanzkriterien

- [ ] `ingest('file.epub', 'Name')` funktioniert wie bisher
- [ ] `ingest('file.pdf', 'Name', 'Project', 'pdf')` funktioniert
- [ ] Source-Registry wird mit `source_type` gefüllt

---

## Aufgabe 6: Frontmatter-Felder aktualisieren

**Dateien:** `src/obsidian-writer.ts`

### Standard-Frontmatter für Source-Blöcke

```yaml
---
type: source_block
source: <source_name>
source_type: epub|pdf|html|url
project: <project>
---
```

### Standard-Frontmatter für Source-Index

```yaml
---
type: source
source_type: epub|pdf|html|url
---
```

### Standard-Frontmatter für Concepts (angepasst)

```yaml
---
type: concept
---
# <name>

## Definition
<description>

## Mentioned in
- [[Source_A]]
- [[Source_B]]
```

### Wichtig

- `type: chapter` → `type: source_block`
- `book:` → `source:`
- `type: book` → `type: source`
- Concepts verlinken jetzt auf Sources, nicht auf Books

### Akzeptanzkriterien

- [ ] Alle neuen Blöcke nutzen `type: source_block`
- [ ] Alle neuen Indizes nutzen `type: source`
- [ ] Concepts listen `sources` statt `books`

---

## Aufgabe 7: CLI-Parameter umbenennen (abwärtskompatibel)

**Datei:** `src/cli.ts`

### Änderungen

1. Usage-Text:
   ```
   Usage: ebook-ingest <source> <source_name> [project] [--type epub|pdf|html|url] [--resume|-r]
   ```
2. Neuer Parameter `--type` (optional). Wenn nicht angegeben, wird das Format aus der Dateiendung erkannt.
3. Interne Variablen: `bookName` → `sourceName`, `epubPath` → `sourcePath`.

### Akzeptanzkriterien

- [ ] `ebook-ingest file.epub "My Book"` funktioniert (auto-detection)
- [ ] `ebook-ingest file.pdf "My PDF" --type pdf` funktioniert (explizit)
- [ ] `ebook-ingest https://example.com "Article" --type url` funktioniert
- [ ] Usage-Text ist aktuell

---

## Aufgabe 8: Tests aktualisieren

### Dateien

- `tests/registry-manager.test.ts`
- `tests/concept-normalizer.test.ts`

### Änderungen

1. Test-Daten von `books` auf `sources` umstellen.
2. Neue Testfälle:
   - `registerSource` schreibt `source_type` korrekt
   - `registerSource` schreibt `original_path` korrekt
   - `registerSource` schreibt `ingested_at` als ISO-8601
   - Concept-Entry nutzt `sources[]`
3. Sicherstellen, dass deprecated-Methoden weiterhin getestet werden.

### Akzeptanzkriterien

- [ ] Alle bestehenden Tests laufen
- [ ] Neue Tests für `registerSource` sind vorhanden
- [ ] Deprecated-Methoden werden getestet

---

## Aufgabe 9: Migration-Script für bestehende Vaults

**Neue Datei:** `src/migrate-vault.ts`

### Anforderungen

Ein kleines Utility, das einen bestehenden Vault von Book-Modell auf Source-Modell migriert:

1. `01_books/` → `05_sources/` (verschieben/kopieren)
2. In allen `.md`-Dateien:
   - `type: book` → `type: source`
   - `type: chapter` → `type: source_block`
   - `book:` → `source:`
   - `source_type: epub` hinzufügen
3. `books_registry.json` → `sources_registry.json`:
   - `source_type: "epub"` zu jedem Eintrag hinzufügen
   - `original_path: ""` (leer, da unbekannt)
   - `ingested_at: ""` (leer, da unbekannt)
4. `concept_registry.json`: `books` → `sources` in allen Einträgen.

### CLI-Integration

```bash
ebook-ingest migrate --vault /path/to/vault [--dry-run]
```

- `--dry-run`: Zeigt nur an, was geändert würde, ohne zu schreiben.

### Akzeptanzkriterien

- [ ] Migration konvertiert alle Felder korrekt
- [ ] `--dry-run` zeigt Änderungen nur an
- [ ] Originaldaten bleiben bei `--dry-run` unberührt
- [ ] Nach Migration funktioniert `ingest` mit dem neuen Modell

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/config.ts` | Ändern (`sourcesDir`, `sourceRegistry`, Deprecations) |
| `src/knowledge-store.ts` | Ändern (`registerSource`, `ConceptEntry.sources`) |
| `src/obsidian-writer.ts` | Ändern (neue Source-Methoden, alte als Wrapper) |
| `src/pipeline.ts` | Ändern (Parameter umbenennen, neue Methoden) |
| `src/cli.ts` | Ändern (Usage, --type Parameter) |
| `src/index.ts` | Ändern (neue Exports) |
| `src/migrate-vault.ts` | **Neu** |
| `tests/registry-manager.test.ts` | Ändern |
| `src/epub-extractor.test.ts` | Ggf. anpassen |
