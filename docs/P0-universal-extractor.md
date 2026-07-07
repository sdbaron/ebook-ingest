# P0 – Universal Extractor (EPUB + PDF + FB2 + HTML + URL)

> **Ziel:** Ein einziger, format-agnostischer Extraction-Layer, der EPUB, PDF, FB2, HTML-Dateien und URLs
> in einheitliche Text-Blöcke (`string[]`) umwandelt. Der restliche Pipeline-Code (LLM, Writer, Registry)
> bleibt **unverändert**.

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | Projekt-Abhängigkeiten hinzufügen | 15 min |
| 2 | `PdfExtractor`-Klasse implementieren | 1,5 h |
| 3 | `Fb2Extractor`-Klasse implementieren | 1,5 h |
| 4 | `HtmlExtractor`-Klasse implementieren | 1 h |
| 5 | `UniversalExtractor`-Factory bauen | 30 min |
| 5 | `EpubExtractor`-Interface vereinheitlichen | 30 min |
| 6 | Unit-Tests schreiben | 1,5 h |
| 7 | Integration in `WikiPipeline` | 1 h |
| 8 | CLI erweitern | 30 min |
| 9 | Manuelles Testen + Doku | 30 min |

Gesamt: ~7 Stunden

---

## Aufgabe 1: Projekt-Abhängigkeiten hinzufügen

**Datei:** `package.json`

Füge folgende Dependencies hinzu:

```bash
pnpm add pdf-parse  # PDF-Text-Extraktion (reiner Text, kein OCR)
```

`pdf-parse` ist eine leichtgewichtige Bibliothek, die den Text-Layer von textbasierten PDFs extrahiert.
OCR (für gescannte PDFs) ist bewusst **nicht** Teil dieser Aufgabe — das käme später optional via `pdf2image` + `tesseract.js`.

### Akzeptanzkriterien
- [ ] `pnpm install` läuft ohne Fehler
- [ ] `import pdf from 'pdf-parse'` funktioniert in einer Testdatei

---

## Aufgabe 2: `PdfExtractor`-Klasse implementieren

**Neue Datei:** `src/pdf-extractor.ts`

### Schnittstelle

```typescript
export class PdfExtractor {
  /** Collapse whitespace and trim */
  static cleanText(text: string): string;

  /**
   * Extract text blocks from a PDF file.
   * Each block is a page or page-group with len > minChars.
   * @param pdfPath  Absolute or relative path to .pdf file
   * @param minChars Minimum characters per block (default: 300)
   */
  static async extract(pdfPath: string, minChars?: number): Promise<string[]>;
}
```

### Detaillierte Anforderungen

1. **Datei einlesen:** Nutze `fs.readFileSync` (weil `pdf-parse` Buffer benötigt), dann `pdf-parse`.
2. **Seitenweise Extraktion:** Iteriere über `pdfRender.page` (die Lib gibt oft eine flache Textstruktur zurück — wir akzeptieren das für v1).
3. **Bereinigung:** `cleanText()` entfernt mehrfache Whitespaces, Page-Breaks, und trimmt.
4. **Minimale Länge:** Blöcke < `minChars` (Default: 300) werden verworfen (leere Seiten, Impressum etc.).
5. **Fehlerbehandlung:** Bei nicht-textbasierten PDFs (z. B. gescannt) soll eine aussagekräftige Warnung erscheinen, und ein leeres Array zurückgegeben werden (kein Crash).

### Hinweise

- `pdf-parse` liefert `{ text: string, numpages: number, ... }`. Der Text enthält `\n\n` zwischen Seiten.
- Du kannst `text.split(/\n\s*\n/)` nutzen, um grobe Seiten-Trennung zu bekommen, oder — besser — die PDF-Seiten iterieren, falls die Library das unterstützt.
- **Fallback-Strategie:** Wenn `pdf-parse` bei einer bestimmten PDF-Variante fehlschlägt, logge eine Warnung und gib `[]` zurück.

### Akzeptanzkriterien
- [ ] Text-basierte PDF wird korrekt extrahiert
- [ ] Leere Seiten (< 300 Zeichen) werden ignoriert
- [ ] Gescannte PDFs (kein Text-Layer) führen zu einer Warnung, nicht zu einem Crash
- [ ] `cleanText` normalisiert Whitespace korrekt

---

## Aufgabe 3: `HtmlExtractor`-Klasse implementieren

**Neue Datei:** `src/html-extractor.ts`

### Schnittstelle

```typescript
export class HtmlExtractor {
  static cleanText(text: string): string;
  static removeBoilerplate($: cheerio.CheerioAPI): void;

  /**
   * Extract text blocks from an HTML file or URL.
   * @param source  File path or URL (detected by http/https prefix)
   * @param minChars Minimum characters per block (default: 200)
   */
  static async extract(source: string, minChars?: number): Promise<string[]>;
}
```

### Detaillierte Anforderungen

1. **Quellenerkennung:** `source.startsWith('http')` → `fetch()`, sonst `fs.readFile`.
2. **Boilerplate-Entfernung:** Entferne `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, `<aside>` per `cheerio`.
3. **Text-Extraktion:** `$('body').text()` oder `$.text()`.
4. **Block-Splitting:** Da HTML oft ein einziger langer Textblock ist, splitte an Satzenden (`. `) und gruppiere in Chunks ≥ `minChars`.
5. **Bereinigung:** `cleanText()` identisch zu `EpubExtractor.cleanText()`.

### Hinweise

- Du kannst `cheerio` wiederverwenden (bereits als Dependency vorhanden).
- Für HTTP-Requests: Nutze die globale `fetch`-API (Node 18+), kein zusätzliches Package nötig.
- Bei großen HTML-Seiten kann der Text sehr lang sein. `split()` sollte sinnvolle Chunks erzeugen — orientiere dich an natürlichen Satzgrenzen.

### Akzeptanzkriterien
- [ ] Lokale HTML-Datei wird korrekt extrahiert
- [ ] URL wird korrekt gefetched und extrahiert
- [ ] Boilerplate (nav, footer, scripts) ist entfernt
- [ ] Text wird in sinnvolle Blöcke gesplittet
- [ ] Fehler bei nicht-erreichbaren URLs werden sauber behandelt

---

## Aufgabe 4: `UniversalExtractor`-Factory bauen

**Neue Datei:** `src/universal-extractor.ts`

### Schnittstelle

```typescript
export type SourceFormat = 'epub' | 'pdf' | 'html' | 'url' | 'fb2';

export interface ExtractionResult {
  blocks: string[];
  format: SourceFormat;
  sourcePath: string;
}

export class UniversalExtractor {
  /**
   * Detect format from extension or URL prefix, then delegate.
   */
  static async extract(sourcePath: string): Promise<ExtractionResult>;

  /** Detect format without extracting */
  static detectFormat(sourcePath: string): SourceFormat;
}
```

### Detaillierte Anforderungen

1. **Format-Erkennung:**
   - `.epub` → `'epub'`
   - `.pdf` → `'pdf'`
   - `.fb2` → `'fb2'`
   - `.html`, `.htm` → `'html'`
   - `http://` oder `https://` → `'url'`
   - Sonst → `Error("Unknown format")`

2. **Delegation:** Rufe je nach Format `EpubExtractor.extract()`, `PdfExtractor.extract()`, `Fb2Extractor.extract()`, oder `HtmlExtractor.extract()` auf.

3. **Rückgabe:** Einheitliches `ExtractionResult` mit Format-Metadaten.

### Hinweise

- Die Factory ist **bewusst einfach** gehalten. Keine Magie — explizite if/else oder switch.
- `ExtractionResult.format` hilft dem Pipeline-Code später, den Source-Typ in Frontmatter zu schreiben.

### Akzeptanzkriterien
- [ ] Alle 5 Formate werden korrekt erkannt
- [ ] Unbekannte Formate werfen einen Error
- [ ] `ExtractionResult` enthält Format und Blöcke

---

## Aufgabe 5: `EpubExtractor`-Interface vereinheitlichen

**Datei:** `src/epub-extractor.ts` (bestehend)

### Änderungen

1. Füge einen optionalen `minChars`-Parameter zu `extract()` hinzu (Default: 500).
2. Stelle sicher, dass die Rückgabe-Signatur mit `PdfExtractor` und `HtmlExtractor` kompatibel ist (`Promise<string[]>`).

### Akzeptanzkriterien
- [ ] `extract(path, 500)` funktioniert wie bisher
- [ ] `extract(path, 100)` lässt kürzere Kapitel zu
- [ ] Bestehende Tests laufen weiterhin

---

## Aufgabe 6: Unit-Tests schreiben

### Neue Dateien
- `tests/pdf-extractor.test.ts`
- `tests/html-extractor.test.ts`
- `tests/universal-extractor.test.ts`

### Testfälle

#### `pdf-extractor.test.ts`
- [ ] Extrahiert Text aus einer validen PDF
- [ ] Gibt leeres Array bei gescannter PDF (kein Crash)
- [ ] Filtert Seiten unter `minChars` aus
- [ ] `cleanText` normalisiert Whitespace

#### `html-extractor.test.ts`
- [ ] Extrahiert Text aus lokaler HTML-Datei
- [ ] Entfernt `<script>`, `<style>`, `<nav>`, `<footer>`
- [ ] Splittet in Blöcke ≥ 200 Zeichen
- [ ] Behandelt HTTP-Fehler (Mock)

#### `universal-extractor.test.ts`
- [ ] Erkennt `.epub` → `'epub'`
- [ ] Erkennt `.pdf` → `'pdf'`
- [ ] Erkennt `.html` → `'html'`
- [ ] Erkennt `https://...` → `'url'`
- [ ] Wirft Error bei unbekanntem Format

### Hinweise

- Lege Test-Fixtures im Ordner `tests/fixtures/` an:
  - `sample.pdf` (minimale Text-PDF)
  - `sample.html` (minimale HTML-Seite)
- Nutze `jest` (bereits konfiguriert).

---

## Aufgabe 7: Integration in `WikiPipeline`

**Datei:** `src/pipeline.ts` (bestehend)

### Änderungen

1. Ersetze den direkten Aufruf von `EpubExtractor.extract()` durch `UniversalExtractor.extract()`.
2. Der `ingest()`-Methode wird statt `epubPath` nun `sourcePath` übergeben.
3. Das `ExtractionResult.format` wird in den Kapitel-Frontmatter geschrieben (neues Feld `source_format`).

**Wichtig:** Die Pipeline-Logik (LLM → Writer → Registry) bleibt **identisch**. Nur die Quelle ändert sich.

### Akzeptanzkriterien
- [ ] `ingest('file.epub', 'Name')` funktioniert wie bisher
- [ ] `ingest('file.pdf', 'Name')` funktioniert
- [ ] `ingest('file.html', 'Name')` funktioniert
- [ ] `ingest('https://...', 'Name')` funktioniert
- [ ] Bestehende Tests laufen weiterhin (ggf. anpassen)

---

## Aufgabe 8: CLI erweitern

**Datei:** `src/cli.ts` (bestehend)

### Änderungen

1. Passe die Usage-Message an:
   ```
   Usage: ebook-ingest <source> <source_name> [project] [options]
   ```
2. Entferne den Begriff "epub" aus allen User-facing Messages.
3. Validiere das Format frühzeitig mit `UniversalExtractor.detectFormat()` und gib eine hilfreiche Fehlermeldung bei unbekannten Formaten.

### Akzeptanzkriterien
- [ ] CLI akzeptiert `.pdf`, `.html`, URLs zusätzlich zu `.epub`
- [ ] Usage-Text ist aktualisiert
- [ ] Unbekannte Formate geben eine verständliche Fehlermeldung

---

## Aufgabe 9: Manuelles Testen + Doku

### Testplan

1. **EPUB:** Wie bisher (Regressions-Test).
2. **PDF (Text):** Eine textbasierte PDF → Kapitel sollten extrahiert werden.
3. **PDF (Scan):** Eine gescannte PDF → Sollte warnen, aber nicht crashen.
4. **HTML (lokal):** Eine gespeicherte Webseite → Sollte sauber extrahiert werden.
5. **URL:** Eine öffentliche Webseite → Sollte gefetched und extrahiert werden.

### README-Update

- [ ] Abschnitt "Features" um PDF/HTML/URL erweitern
- [ ] Abschnitt "Verwendung" um PDF/HTML/URL-Beispiele erweitern
- [ ] Ggf. `pdf-parse` als Voraussetzung dokumentieren

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/pdf-extractor.ts` | **Neu** |
| `src/fb2-extractor.ts` | **Neu** |
| `src/html-extractor.ts` | **Neu** |
| `src/universal-extractor.ts` | **Neu** |
| `src/epub-extractor.ts` | Ändern (minChars-Parameter) |
| `src/pipeline.ts` | Ändern (UniversalExtractor einbinden) |
| `src/cli.ts` | Ändern (Usage, Format-Validierung) |
| `src/index.ts` | Ändern (neue Exports) |
| `package.json` | Ändern (pdf-parse Dependency) |
| `tests/pdf-extractor.test.ts` | **Neu** |
| `tests/fb2-extractor.test.ts` | **Neu** |
| `tests/html-extractor.test.ts` | **Neu** |
| `tests/universal-extractor.test.ts` | **Neu** |
| `tests/fixtures/sample.pdf` | **Neu** |
| `tests/fixtures/sample.fb2` | **Neu** |
| `tests/fixtures/sample.html` | **Neu** |
| `README.md` | Ändern |
