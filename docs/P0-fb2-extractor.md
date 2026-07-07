<!-- markdownlint-disable MD024 -->

# P0 – FB2Extractor (FictionBook 2 Support)

> **Ziel:** Unterstützung für das FictionBook-2-Format (`.fb2`) hinzufügen.
> FB2 ist ein XML-basiertes E-Book-Format, das vor allem im russischsprachigen Raum
> verbreitet ist. Die neue Klasse `Fb2Extractor` soll nahtlos in den `UniversalExtractor`
> integriert werden — ohne neue npm-Abhängigkeiten (`cheerio` wird bereits genutzt).

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | `Fb2Extractor`-Klasse mit `cleanText` und `extract` implementieren | 1,5 h |
| 2 | Cheerio im XML-Modus + Namespace-Handling | 30 min |
| 3 | Section-Extraktion mit Rekursion für verschachtelte `<section>` | 1 h |
| 4 | Fehlerbehandlung: malformiertes XML, leere Datei, falsches Encoding | 30 min |
| 5 | Integration in `UniversalExtractor` (`SourceFormat`, `detectFormat`, `switch`) | 30 min |
| 6 | `src/index.ts` um `Fb2Extractor`-Export erweitern | 15 min |
| 7 | Test-Fixture `tests/fixtures/sample.fb2` anlegen | 15 min |
| 8 | Unit-Tests schreiben (`tests/fb2-extractor.test.ts`) | 1,5 h |

Gesamt: ~6 Stunden

---

## Hintergrund: Das FB2-Format

FictionBook 2 ist ein XML-Schema für E-Books. Eine FB2-Datei ist wohlgeformtes XML
mit dieser Grundstruktur:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"
             xmlns:l="http://www.w3.org/1999/xlink">

  <description>
    <title-info>
      <author><first-name>John</first-name><last-name>Doe</last-name></author>
      <book-title>Clean Architecture</book-title>
      <lang>en</lang>
    </title-info>
  </description>

  <body>
    <section>
      <title><p>Chapter 1: Introduction</p></title>
      <p>First paragraph of chapter 1 ...</p>
      <p>Second paragraph ...</p>
    </section>

    <section>
      <title><p>Chapter 2</p></title>
      <section>                            <!-- verschachtelte Section -->
        <title><p>2.1 Sub-Section</p></title>
        <p>Sub-section content ...</p>
      </section>
      <p>More top-level content ...</p>
    </section>
  </body>

</FictionBook>
```

### Relevante XML-Elemente

| Element | Bedeutung |
| --- | --- |
| `<body>` | Hauptinhalt des Buches (ein oder mehrere) |
| `<section>` | Kapitel oder Unterkapitel (beliebig tief verschachtelt) |
| `<title>` | Kapitelüberschrift (enthält `<p>`) |
| `<p>` | Absatz mit Fließtext |
| `<emphasis>` | Kursiv — Inhalt extrahieren, Tag ignorieren |
| `<strong>` | Fett — Inhalt extrahieren, Tag ignorieren |
| `<epigraph>` | Epigraph — **ignorieren** |
| `<annotation>` | Klappentext — **ignorieren** |
| `<image>` | Bild-Referenz — **ignorieren** |
| `<description>` | Metadaten — **ignorieren** (kein Fließtext) |

### Bekannte Einschränkungen (bewusst out of scope)

- **Encoding:** Nur UTF-8 wird vollständig unterstützt. Windows-1251-kodierte FB2-Dateien
  (häufig bei älteren russischen E-Books) können fehlerhaft dargestellt werden.
  → Warnung ausgeben, trotzdem versuchen zu parsen.
- **`.fb2.zip`:** Komprimierte FB2-Dateien werden **nicht** unterstützt.
  → Fehlermeldung mit Hinweis auf manuelles Entpacken.
- **Mehrere `<body>`-Elemente:** Manche FB2-Dateien enthalten einen zweiten `<body>` für
  Anmerkungen. Nur der erste `<body>` wird verarbeitet.

---

## Aufgabe 1 + 2: `Fb2Extractor`-Klasse implementieren

**Neue Datei:** `src/fb2-extractor.ts`

### Schnittstelle

```typescript
import * as cheerio from 'cheerio';

export class Fb2Extractor {
  /**
   * Collapse whitespace, remove residual XML artifacts and trim.
   */
  static cleanText(text: string): string;

  /**
   * Extract text blocks from an FB2 file.
   * Each top-level <section> inside <body> becomes one block.
   * Nested <section> elements are flattened into their parent block.
   *
   * @param fb2Path  Absolute path to the .fb2 file
   * @param minChars Minimum characters per block (default: 300)
   * @returns Array of cleaned text blocks
   */
  static async extract(fb2Path: string, minChars?: number): Promise<string[]>;

  /**
   * Recursively extract all text content from a <section> element,
   * including nested sections.
   */
  private static extractSectionText(
    $: cheerio.CheerioAPI,
    section: cheerio.Element,
  ): string;
}
```

### Implementierungsvorlage

```typescript
import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';

export class Fb2Extractor {
  static cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')       // Windows-Zeilenenden normalisieren
      .replace(/\s+/g, ' ')         // Mehrfache Whitespaces kollabieren
      .trim();
  }

  static async extract(fb2Path: string, minChars: number = 300): Promise<string[]> {
    // 1. Datei einlesen
    let xml: string;
    try {
      xml = await fs.readFile(fb2Path, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] Cannot read FB2 file "${fb2Path}": ${message}`);
      return [];
    }

    // .fb2.zip-Erkennung (Magic-Bytes: 50 4B 03 04)
    if (xml.startsWith('PK')) {
      console.warn(
        `[WARN] "${fb2Path}" appears to be a compressed .fb2.zip file. ` +
        'Please extract it first. Only plain .fb2 files are supported.',
      );
      return [];
    }

    // 2. XML mit cheerio parsen (xmlMode: true, Namespace-Behandlung)
    let $: cheerio.CheerioAPI;
    try {
      $ = cheerio.load(xml, { xmlMode: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] Failed to parse FB2 XML in "${fb2Path}": ${message}`);
      return [];
    }

    // 3. Ersten <body> finden (Namespace-agnostisch)
    //    FB2 verwendet xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"
    //    cheerio im xmlMode behandelt den Default-Namespace transparent,
    //    daher funktioniert $('body') oder $('FictionBook > body') direkt.
    const body = $('body').first();
    if (!body.length) {
      console.warn(`[WARN] No <body> element found in "${fb2Path}". Is this a valid FB2 file?`);
      return [];
    }

    // 4. Top-Level <section>-Elemente extrahieren
    const blocks: string[] = [];
    body.children('section').each((_i, sectionEl) => {
      const text = Fb2Extractor.extractSectionText($, sectionEl);
      const cleaned = Fb2Extractor.cleanText(text);
      if (cleaned.length >= minChars) {
        blocks.push(cleaned);
      }
    });

    return blocks;
  }

  private static extractSectionText(
    $: cheerio.CheerioAPI,
    section: cheerio.Element,
  ): string {
    const parts: string[] = [];

    $(section).children().each((_i, child) => {
      const tagName = (child as cheerio.Element).tagName?.toLowerCase();

      if (tagName === 'title') {
        // Titeltext mit Leerzeile davor/danach für Lesbarkeit
        const titleText = $(child).text().trim();
        if (titleText) parts.push(titleText);

      } else if (tagName === 'section') {
        // Rekursiv: verschachtelte Section einbetten
        parts.push(Fb2Extractor.extractSectionText($, child as cheerio.Element));

      } else if (['epigraph', 'annotation', 'image', 'binary'].includes(tagName ?? '')) {
        // Nicht-Fließtext-Elemente überspringen

      } else {
        // <p>, <emphasis>, <strong>, <poem>, <cite>, <subtitle> etc.
        const text = $(child).text().trim();
        if (text) parts.push(text);
      }
    });

    return parts.join(' ');
  }
}
```

### Hinweise zu cheerio im XML-Modus

- `cheerio.load(xml, { xmlMode: true })` aktiviert den XML-Parser (kein HTML5-Fallback).
- Der FB2-Default-Namespace wird von cheerio **transparent** gehandhabt — Selektoren wie
  `$('body')`, `$('section')`, `$('p')` funktionieren ohne Namespace-Präfix.
- Achte auf Groß-/Kleinschreibung: Im XML-Modus sind Tags case-sensitiv.
  FB2 nutzt ausschließlich Kleinbuchstaben (`<section>`, nicht `<Section>`).

### Akzeptanzkriterien

- [ ] UTF-8-kodierte FB2-Datei wird korrekt gelesen und geparst
- [ ] Jede Top-Level-`<section>` ergibt genau einen Block
- [ ] Verschachtelte `<section>`-Elemente werden in den Eltern-Block eingebettet
- [ ] `<epigraph>`, `<annotation>`, `<image>` erscheinen **nicht** im Output
- [ ] `<title>`-Inhalt erscheint am Anfang des jeweiligen Blocks
- [ ] `cleanText` normalisiert Whitespace korrekt (Newlines, Tabs, mehrfache Spaces)
- [ ] Blöcke unter `minChars` (Default: 300) werden verworfen

---

## Aufgabe 3: Fehlerbehandlung

Alle Fehler werden als Warnungen geloggt — es wird **nie** eine Exception geworfen.
Die Methode `extract()` gibt im Fehlerfall immer `[]` zurück.

| Fehlerfall | Erwartetes Verhalten |
| --- | --- |
| Datei existiert nicht | `[WARN] Cannot read FB2 file "…": ENOENT…` → `[]` |
| Datei ist leer | `[WARN] No <body> element found in "…"` → `[]` |
| Malformiertes XML (z. B. unclosed tag) | `[WARN] Failed to parse FB2 XML in "…"` → `[]` |
| `.fb2.zip` (komprimiert) | `[WARN] "…" appears to be a compressed .fb2.zip file…` → `[]` |
| Kein `<body>`-Element | `[WARN] No <body> element found in "…"` → `[]` |
| Alle Sections unter `minChars` | Kein Warn-Log, leeres Array ist valides Ergebnis |

### Akzeptanzkriterien

- [ ] Nicht-existente Datei → `[]` + Warnung (kein Crash)
- [ ] `.fb2.zip`-Datei → `[]` + Hinweis auf manuelles Entpacken
- [ ] Malformiertes XML → `[]` + Warnung (kein Crash)
- [ ] Leere Datei → `[]` + Warnung

---

## Aufgabe 4: Integration in `UniversalExtractor`

**Datei:** `src/universal-extractor.ts`

### 4a: `SourceFormat` erweitern

```typescript
// Vorher:
export type SourceFormat = 'epub' | 'pdf' | 'html' | 'url';

// Nachher:
export type SourceFormat = 'epub' | 'pdf' | 'html' | 'url' | 'fb2';
```

### 4b: `detectFormat()` erweitern

Im `detectFormat`-Switch die `.fb2`-Erkennung ergänzen:

```typescript
if (ext === '.fb2') return 'fb2';
```

Einfügen **vor** dem abschließenden `throw`-Statement, nach dem `.html`/`.htm`-Check.

Außerdem die Fehlermeldung aktualisieren:

```typescript
throw new Error(
  `Unknown format for "${sourcePath}". ` +
  `Supported formats: .epub, .pdf, .html, .htm, .fb2, http://, https://`,
);
```

### 4c: `extract()`-Switch erweitern

```typescript
case 'fb2':
  blocks = await Fb2Extractor.extract(sourcePath, minChars);
  break;
```

### 4d: Import ergänzen

```typescript
import { Fb2Extractor } from './fb2-extractor.js';
```

### 4e: Preprocessing-Format

Der `TextPreprocessor` kennt `fb2` als Format noch nicht. Da FB2 sauber strukturiertes XML
ist (keine PDF-Header/Footer, kein HTML-Boilerplate), reicht der generische Qualitätsfilter.
Übergib `'epub'` als Fallback-Format an den Preprocessor bis FB2 explizit ergänzt wird:

```typescript
// Im preprocessing-Block:
const preprocessFormat = format === 'fb2' ? 'epub' : format;
const result = this.preprocessor.process(blocks, preprocessFormat);
```

### Akzeptanzkriterien

- [ ] `UniversalExtractor.detectFormat('book.fb2')` → `'fb2'`
- [ ] `UniversalExtractor.detectFormat('BOOK.FB2')` → `'fb2'` (case-insensitive)
- [ ] `UniversalExtractor.extract('book.fb2')` delegiert an `Fb2Extractor.extract()`
- [ ] `ExtractionResult.format` ist `'fb2'`
- [ ] Fehlertext für unbekannte Formate enthält `.fb2`
- [ ] Bestehende Tests für `.epub`, `.pdf`, `.html` laufen weiterhin

---

## Aufgabe 5: `src/index.ts` erweitern

Die neue Klasse zum Public API der Bibliothek hinzufügen.
Einfügen **nach** dem `HtmlExtractor`-Export:

```typescript
export { Fb2Extractor } from './fb2-extractor.js';
```

### Akzeptanzkriterien

- [ ] `import { Fb2Extractor } from '@tagesberichte/ebook-ingest'` funktioniert

---

## Aufgabe 6: Test-Fixture anlegen

**Neue Datei:** `tests/fixtures/sample.fb2`

Die Fixture muss folgende Eigenschaften haben:

- Valides, wohlgeformtes XML (UTF-8)
- Mindestens 3 Top-Level-`<section>`-Elemente
- Jede Section hat `≥ 300` Zeichen Text (damit sie den Default-`minChars`-Filter passiert)
- Eine Section enthält eine verschachtelte `<section>`
- Enthält `<epigraph>` und `<image>`-Element (für Boilerplate-Tests)
- `<emphasis>` und `<strong>` sind enthalten (Text soll trotzdem extrahiert werden)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"
             xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>science</genre>
      <author>
        <first-name>Test</first-name>
        <last-name>Author</last-name>
      </author>
      <book-title>Test FB2 Book</book-title>
      <lang>en</lang>
    </title-info>
    <document-info>
      <date value="2026-01-01">2026-01-01</date>
      <id>test-fixture-001</id>
      <version>1.0</version>
    </document-info>
  </description>

  <body>
    <section>
      <title><p>Chapter 1: Introduction</p></title>
      <epigraph>
        <p>This epigraph should not appear in extracted text.</p>
      </epigraph>
      <p>This is the first paragraph of Chapter 1. It contains enough text to pass
         the minimum character threshold. The <emphasis>FB2 extractor</emphasis> should
         parse this XML correctly and return clean plain text without any tags.</p>
      <p>This is the second paragraph of Chapter 1. Additional content to ensure the
         block comfortably exceeds the minimum length requirement for extraction.
         The <strong>extractor</strong> must handle inline formatting tags transparently.</p>
    </section>

    <section>
      <title><p>Chapter 2: Main Content</p></title>
      <p>This is the main content section of Chapter 2. The extractor should create
         a separate block for each top-level section in the FictionBook document.
         Each section becomes one entry in the returned string array.</p>
      <section>
        <title><p>Chapter 2.1: Nested Sub-Section</p></title>
        <p>This nested sub-section should be flattened into the parent Chapter 2 block.
           The recursive extraction ensures that no content is lost due to nesting.
           All paragraphs at any depth are included in the parent block text.</p>
      </section>
      <image l:href="#cover"/>
      <p>Final paragraph of Chapter 2 after the nested section and image reference.</p>
    </section>

    <section>
      <title><p>Chapter 3: Conclusion</p></title>
      <p>This concluding chapter brings the test book to an end. It demonstrates
         that the Fb2Extractor correctly handles multiple top-level sections and
         converts each one to an individual cleaned text block for the pipeline.</p>
      <p>The extractor should return exactly three blocks from this fixture: one for
         each top-level section. Nested sections are merged into their parent block.
         Epigraphs, annotations, and image references are silently discarded.</p>
    </section>
  </body>
</FictionBook>
```

### Akzeptanzkriterien

- [ ] Fixture-Datei ist valides XML (prüfbar mit
  `node -e "import('node:fs').then(fs => console.log(fs.readFileSync('tests/fixtures/sample.fb2', 'utf-8').slice(0,50)))"`)
- [ ] Enthält alle für die Tests benötigten Strukturen

---

## Aufgabe 7: Unit-Tests schreiben

**Neue Datei:** `tests/fb2-extractor.test.ts`

### Teststruktur

```typescript
import { describe, it, expect } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fb2Extractor } from '../src/fb2-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');
const sampleFb2 = path.resolve(fixturesDir, 'sample.fb2');
```

### Testfälle `cleanText`

| Test | Input | Erwarteter Output |
| --- | --- | --- |
| Mehrfache Spaces kollabieren | `'hello    world'` | `'hello world'` |
| Trimmen | `'  hello world  '` | `'hello world'` |
| Tabs und Newlines | `'hello\n\tworld'` | `'hello world'` |
| Windows-Zeilenenden | `'hello\r\nworld'` | `'hello world'` |
| Leerer String | `''` | `''` |

### Testfälle `extract`

```text
describe('extract', () => {
  // Grundfunktion
  it('extracts text blocks from a valid FB2 file')
    → blocks.length === 3 (eine pro Top-Level-Section)

  // Blockinhalt
  it('includes chapter title in the block text')
    → allText enthält 'Chapter 1: Introduction'

  it('includes paragraph content')
    → allText enthält 'first paragraph of Chapter 1'

  // Boilerplate-Ausschluss
  it('excludes epigraph content')
    → allText enthält NICHT 'This epigraph should not appear'

  it('excludes image references')
    → kein '<image' oder 'l:href' im extrahierten Text

  // Inline-Formatting: Tags entfernt, Text erhalten
  it('extracts text from <emphasis> and <strong> tags')
    → allText enthält 'FB2 extractor' (ohne Tag-Wrapper)

  // Verschachtelung
  it('flattens nested sections into parent block')
    → blocks.length === 3 (nicht 4 — nested section ist kein eigener Block)
    → blocks[1] enthält 'Nested Sub-Section'

  // minChars-Filter
  it('filters out blocks below minChars')
    → await Fb2Extractor.extract(sampleFb2, 99999) → []

  // Fehlerbehandlung
  it('returns empty array for non-existent file')
    → result === []

  it('returns empty array for empty file content')
    → Temp-Datei mit leerem Inhalt → result === []

  it('returns empty array and warns for malformed XML')
    → Temp-Datei mit '<FictionBook><unclosed' → result === []

  it('returns empty array and warns for .fb2.zip input')
    → Temp-Datei mit 'PK...' Inhalt → result === []
})
```

### Hinweis zu Temp-Dateien in Tests

Für Fehlerfall-Tests (malformiertes XML, leere Datei, `.fb2.zip`) nutze `os.tmpdir()`:

```typescript
import os from 'node:os';
import fs from 'node:fs/promises';

const tmpFile = path.resolve(os.tmpdir(), `test-${Date.now()}.fb2`);
await fs.writeFile(tmpFile, '<FictionBook><unclosed', 'utf-8');
const result = await Fb2Extractor.extract(tmpFile);
expect(result).toEqual([]);
await fs.unlink(tmpFile); // Aufräumen
```

### Akzeptanzkriterien

- [ ] Alle Tests aus der obigen Liste sind implementiert
- [ ] `pnpm test` läuft ohne Fehler
- [ ] Keine `console.warn`-Aufrufe in den Happy-Path-Tests (via `jest.spyOn` prüfbar)

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion | Inhalt |
| --- | --- | --- |
| `src/fb2-extractor.ts` | **Neu** | `Fb2Extractor`-Klasse |
| `src/universal-extractor.ts` | Ändern | `SourceFormat`, `detectFormat`, `switch`, Import |
| `src/index.ts` | Ändern | Export `Fb2Extractor` |
| `tests/fb2-extractor.test.ts` | **Neu** | Unit-Tests |
| `tests/fixtures/sample.fb2` | **Neu** | Test-Fixture |

**Keine neuen npm-Abhängigkeiten erforderlich** — `cheerio` wird bereits genutzt.

---

## Akzeptanzkriterien gesamt (Definition of Done)

- [ ] `pnpm test` — alle 103 bestehenden Tests + neue FB2-Tests grün
- [ ] `Fb2Extractor.extract('tests/fixtures/sample.fb2')` gibt 3 Blöcke zurück
- [ ] `UniversalExtractor.detectFormat('book.fb2')` → `'fb2'`
- [ ] `UniversalExtractor.extract('book.fb2')` delegiert korrekt an `Fb2Extractor`
- [ ] Kein TypeScript-Compilerfehler (`pnpm build`)
- [ ] Fehlerbehandlung deckt alle 4 Fehlerfälle ab (ENOENT, leer, malformed, .zip)
- [ ] Encoding-Einschränkung (Windows-1251) ist in einem Code-Kommentar dokumentiert
