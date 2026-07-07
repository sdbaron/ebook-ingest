<!-- markdownlint-disable MD024 -->

# P1 – Preprocessing Layer

> **Ziel:** Ein einheitlicher Preprocessing-Layer, der vor der LLM-Analyse Text bereinigt:
> PDF-Header/Footer entfernen, HTML-Boilerplate filtern, Kapitelgrenzen erkennen,
> und die Textqualität für die LLM-Analyse verbessern.

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | `TextPreprocessor`-Klasse entwerfen | 45 min |
| 2 | PDF-Header/Footer-Erkennung und -Entfernung | 1,5 h |
| 3 | HTML-Boilerplate-Remover verbessern | 1 h |
| 4 | Chapter-Detection-Heuristiken | 1,5 h |
| 5 | Text-Qualitäts-Filter (zu kurze Blöcke, Wiederholungen) | 45 min |
| 6 | Integration in `UniversalExtractor` | 1 h |
| 7 | Konfigurierbarkeit (Preprocessing-Optionen) | 30 min |
| 8 | Unit-Tests schreiben | 1,5 h |

Gesamt: ~8,5 Stunden

---

## Konzept

### Pipeline mit Preprocessing

```text
EPUB / PDF / FB2 / HTML / URL
         ↓
   UniversalExtractor
         ↓
   Raw Text Blocks
         ↓
   TextPreprocessor     ← NEU
         ↓
   Cleaned Text Blocks
         ↓
   LLM Analyzer
         ↓
   Concepts + Summaries
```

### Was der Preprocessor macht

| Schritt | EPUB | PDF | FB2 | HTML |
| --- | --- | --- | --- | --- |
| Header/Footer entfernen | — | ✅ | — | — |
| Boilerplate entfernen | — | — | — | ✅ |
| Kapitelerkennung | — | ✅ | — | ✅ |
| Qualitätsfilter | ✅ | ✅ | ✅ | ✅ |
| Whitespace normalisieren | ✅ | ✅ | ✅ | ✅ |

---

## Aufgabe 1: `TextPreprocessor`-Klasse entwerfen

**Neue Datei:** `src/text-preprocessor.ts`

### Schnittstelle

```typescript
export interface PreprocessorOptions {
  /** Remove PDF headers/footers (repeating text at top/bottom) */
  removeHeadersFooters: boolean;
  /** Minimum characters for a block to be kept */
  minBlockLength: number;
  /** Maximum characters for a block (split longer blocks) */
  maxBlockLength: number;
  /** Attempt to detect chapter boundaries */
  detectChapters: boolean;
  /** Remove boilerplate patterns (page numbers, copyright, etc.) */
  removeBoilerplate: boolean;
}

export interface PreprocessResult {
  blocks: string[];
  /** Statistics about what was removed */
  stats: {
    originalBlockCount: number;
    filteredBlockCount: number;
    removedHeadersFooters: number;
    splitBlocks: number;
    mergedShortBlocks: number;
  };
}

export class TextPreprocessor {
  constructor(private options: PreprocessorOptions);

  /**
   * Process raw text blocks and return cleaned blocks.
   */
  process(blocks: string[],
   sourceFormat: 'epub' | 'pdf' | 'html' | 'url' | 'fb2'): PreprocessResult;

  // Spezifische Methoden
  private removePdfHeadersFooters(blocks: string[]): string[];
  private removeBoilerplatePatterns(text: string): string;
  private detectChapterBoundaries(blocks: string[]): string[];
  private filterByLength(blocks: string[]): string[];
  private splitLongBlocks(blocks: string[]): string[];
  private mergeShortBlocks(blocks: string[]): string[];
}
```

### Default-Optionen

```typescript
export const defaultPreprocessorOptions: PreprocessorOptions = {
  removeHeadersFooters: true,
  minBlockLength: 200,
  maxBlockLength: 15000,
  detectChapters: true,
  removeBoilerplate: true,
};
```

### Akzeptanzkriterien

- [ ] Interface vollständig definiert
- [ ] Default-Optionen sind sinnvoll
- [ ] `process()` delegiert je nach `sourceFormat` an die richtigen Methoden

---

## Aufgabe 2: PDF-Header/Footer-Erkennung und -Entfernung

### Algorithmus

PDF-Seiten haben oft wiederkehrende Header (Kapitelname, Autor) und Footer (Seitenzahlen).
Diese werden entfernt, bevor der Text ans LLM geht.

### Ansatz: Längster gemeinsamer Prefix/Suffix

1. Wenn mehrere Seiten-Blöcke vorhanden sind,
 vergleiche die ersten ~80 Zeichen jeder Seite.
2. Finde den längsten gemeinsamen Prefix über alle Seiten.
3. Wenn dieser Prefix auf >50% der Seiten identisch ist → Header → entfernen.
4. Gleiche Logik für die letzten ~80 Zeichen (Footer).

```typescript
private removePdfHeadersFooters(blocks: string[]): string[] {
  if (blocks.length < 3) return blocks; // Zu wenige Seiten für Mustererkennung

  const headerLen = this.findCommonPrefixLength(blocks.map(b => b.slice(0, 80)));
  const footerLen = this.findCommonSuffixLength(blocks.map(b => b.slice(-80)));

  return blocks.map(block => {
    let cleaned = block;
    if (headerLen > 20) {
      cleaned = cleaned.slice(headerLen);
    }
    if (footerLen > 10) {
      cleaned = cleaned.slice(0, -footerLen);
    }
    return cleaned.trim();
  });
}
```

### Seitenzahlen-Erkennung

Zusätzlich: Regex für alleinstehende Seitenzahlen am Anfang/Ende einer Zeile:

```typescript
// Entferne Zeilen, die nur aus einer Zahl bestehen (Seitenzahlen)
cleaned = cleaned.replace(/^\d{1,4}\s*$/gm, '');
// Entferne "Seite X von Y"-Muster
cleaned = cleaned.replace(/seite\s+\d+\s+(von|of)\s+\d+/gi, '');
```

### Akzeptanzkriterien

- [ ] Wiederholte Header werden erkannt und entfernt
- [ ] Seitenzahlen werden entfernt
- [ ] Einzelseitige PDFs werden nicht verändert
- [ ] Text zwischen Header und Footer bleibt erhalten

---

## Aufgabe 3: HTML-Boilerplate-Remover verbessern

### Aktueller Stand

`HtmlExtractor` entfernt bereits `<script>`, `<style>`, `<nav>`, `<footer>`.
 Das reicht für einfache Seiten, aber nicht für komplexe Webseiten.

### Erweiterungen

1. **Zusätzliche Tag-Filter:** `<header>`, `<aside>`, `<form>`,
 `<noscript>`, `[role="navigation"]`, `[role="banner"]`, `[role="contentinfo"]`
2. **CSS-Klassen-basierte Filter:** Entferne Elemente mit Klassen wie
`sidebar`, `menu`, `comment`, `advertisement`, `cookie`, `popup`
3. **Text-basierte Filter nach Extraktion:**
   - Entferne Zeilen, die typischen Boilerplate-Text enthalten:

     ```typescript
     const boilerplatePatterns = [
       /copyright\s*©?\s*\d{4}/i,
       /all rights reserved/i,
       /terms (of|and) (service|use|conditions)/i,
       /privacy policy/i,
       /cookie (policy|consent|notice)/i,
       /subscribe to our newsletter/i,
       /click here to (accept|agree|subscribe)/i,
       /we use cookies/i,
       /sign (up|in) (for|to)/i,
       /published (on|at)/i,
       /by \[author name\]/i,
     ];
     ```

### Akzeptanzkriterien

- [ ] Navigation, Sidebar, Footer werden entfernt
- [ ] Cookie-Banner werden entfernt
- [ ] Copyright-Zeilen werden entfernt
- [ ] Hauptinhalt bleibt erhalten

---

## Aufgabe 4: Chapter-Detection-Heuristiken

### Problem

PDFs und HTML-Seiten haben oft keine expliziten Kapitelmarkierungen. Der Text ist ein
langer Fluss. Das LLM bekommt dann entweder zu viel oder zu wenig Kontext.

### Lösung

Heuristische Erkennung von Kapitelgrenzen basierend auf Textmustern:

```typescript
private detectChapterBoundaries(blocks: string[]): string[] {
  const result: string[] = [];
  
  for (const block of blocks) {
    const lines = block.split('\n');
    const chapters: string[] = [];
    let currentChapter = '';
    
    for (const line of lines) {
      // Muster für Kapitelanfänge
      if (this.isChapterHeading(line)) {
        if (currentChapter.trim().length > 0) {
          chapters.push(currentChapter.trim());
        }
        currentChapter = line + '\n';
      } else {
        currentChapter += line + '\n';
      }
    }
    
    if (currentChapter.trim().length > 0) {
      chapters.push(currentChapter.trim());
    }
    
    result.push(...chapters);
  }
  
  return result;
}

private isChapterHeading(line: string): boolean {
  const patterns = [
    /^(chapter|kapitel|kap\.|ch\.)\s+\d+/i,
    /^\d+\.\s+[A-ZÄÖÜ][a-zäöü]+/,           // "1. Introduction"
    /^[IVX]+\.\s+[A-ZÄÖÜ]/,                 // "IV. Methodology"
    /^(part|teil|section|abschnitt)\s+\d+/i,
    /^#+\s/,                                  // Markdown headings
    /^[A-ZÄÖÜ][A-ZÄÖÜ\s]{3,60}$/,           // ALL CAPS TITLE (potentiell Kapitel)
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/,           // Datum (eher kein Kapitel) → false
  ];
  
  // Auf keinen Fall als Kapitel erkennen:
  const negativePatterns = [
    /^\d+$/,                     // Nur Zahlen (Seitenzahlen)
    /^[a-z]/,                    // Kleingeschrieben
    /.{100,}/,                   // Zu lang für Überschrift
  ];
  
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (negativePatterns.some(p => p.test(trimmed))) return false;
  
  return patterns.some(p => p.test(trimmed));
}
```

### Kapitel-Nummerierung

Wenn Kapitel erkannt wurden, werden sie mit einem `chapter_hint`-Index versehen
(z. B. `"Kapitel 3: Dependency Inversion"` → `chapterHint: 3`). Diese Information
kann im Frontmatter gespeichert werden.

### Akzeptanzkriterien

- [ ] "Chapter 1", "Kapitel 2", "1. Introduction" werden erkannt
- [ ] Römische Ziffern werden erkannt (IV., X.)
- [ ] Seitenzahlen werden NICHT als Kapitel erkannt
- [ ] Leere Zeilen werden ignoriert
- [ ] Langer Fließtext wird an Kapitelgrenzen geteilt

---

## Aufgabe 5: Text-Qualitäts-Filter

### Filter-Regeln

1. **Zu kurze Blöcke:** `< minBlockLength` → verwerfen
2. **Zu lange Blöcke:** `> maxBlockLength` → an Satzgrenzen splitten
3. **Wiederholungen:** Wenn ein Block zu >80% aus dem gleichen Satz besteht → verwerfen
4. **Nicht-Text-Inhalt:** Blöcke mit >30% Nicht-Buchstaben-Zeichen → verwerfen
5. **Leere/Whitespace-only Blöcke:** → verwerfen

```typescript
private filterByQuality(blocks: string[]): string[] {
  return blocks.filter(block => {
    const text = block.trim();
    
    // Leer oder nur Whitespace
    if (text.length === 0) return false;
    
    // Zu kurz
    if (text.length < this.options.minBlockLength) return false;
    
    // Zu viele Nicht-Buchstaben (Tabellen, Code-Blöcke, etc.)
    const letterRatio = (text.match(/[A-Za-zÄÖÜäöüß]/g) || []).length / text.length;
    if (letterRatio < 0.5) return false;
    
    // Wiederholungserkennung
    if (this.isRepetitive(text)) return false;
    
    return true;
  });
}

private isRepetitive(text: string): boolean {
  // Teile in Sätze, prüfe ob ein Satz >50% des Texts ausmacht
  const sentences = text.split(/[.!?]\s+/);
  if (sentences.length < 3) return false;
  
  for (const sentence of sentences) {
    const count = (text.match(new RegExp(sentence.slice(0, 30), 'g')) || []).length;
    if (count > sentences.length * 0.8) return true;
  }
  
  return false;
}
```

### Akzeptanzkriterien

- [ ] Blöcke < 200 Zeichen werden verworfen
- [ ] Code-Blöcke/Tabellen werden erkannt und verworfen
- [ ] Repetitive Blöcke werden verworfen
- [ ] Qualitativ guter Text bleibt erhalten

---

## Aufgabe 6: Integration in `UniversalExtractor`

**Datei:** `src/universal-extractor.ts` (bestehend aus P0)

### Änderungen

1. `UniversalExtractor` erhält eine optionale `TextPreprocessor`-Instanz.
2. Nach der Roh-Extraktion wird `preprocessor.process()` aufgerufen.
3. Die Statistiken werden geloggt:

```text
[INFO] PDF extracted: 142 raw blocks
[PREPROCESS] Headers/footers removed from 140 blocks
[PREPROCESS] Chapter boundaries detected → 12 chapters
[PREPROCESS] Filtered: 142 → 12 blocks (130 filtered out)
```

### Code-Änderung

```typescript
export class UniversalExtractor {
  constructor(private preprocessor?: TextPreprocessor) {}

  static async extract
  (sourcePath: string, preprocessor?: TextPreprocessor)
  :Promise<ExtractionResult> {
    const format = UniversalExtractor.detectFormat(sourcePath);
    let blocks: string[];

    switch (format) {
      case 'epub': blocks = await EpubExtractor.extract(sourcePath); break;
      case 'pdf': blocks = await PdfExtractor.extract(sourcePath); break;
      case 'html': case 'url': blocks = await HtmlExtractor.extract(sourcePath); break;
    }

    if (preprocessor) {
      const result = preprocessor.process(blocks, format);
      console.log(`[PREPROCESS] ${result.stats.originalBlockCount}
       → ${result.stats.filteredBlockCount} blocks`);
      blocks = result.blocks;
    }

    return { blocks, format, sourcePath };
  }
}
```

### Akzeptanzkriterien

- [ ] `UniversalExtractor` nutzt den Preprocessor, wenn vorhanden
- [ ] Ohne Preprocessor funktioniert alles wie bisher
- [ ] Statistiken werden geloggt

---

## Aufgabe 7: Konfigurierbarkeit

**Datei:** `src/config.ts` (erweitern)

### Neue Config-Felder

```typescript
export interface EbookIngestConfig {
  // ...existing...
  /** Preprocessing options (set to false to disable) */
  preprocess: PreprocessorOptions | false;
}
```

### Default

```typescript
export const defaultConfig: EbookIngestConfig = {
  // ...existing...
  preprocess: {
    removeHeadersFooters: true,
    minBlockLength: 200,
    maxBlockLength: 15000,
    detectChapters: true,
    removeBoilerplate: true,
  },
};
```

### Akzeptanzkriterien

- [ ] Preprocessing ist per Default an
- [ ] `preprocess: false` deaktiviert alle Preprocessing-Schritte
- [ ] Einzelne Optionen können überschrieben werden

---

## Aufgabe 8: Unit-Tests schreiben

**Neue Datei:** `tests/text-preprocessor.test.ts`

### Testfälle

#### Header/Footer-Entfernung

- [ ] Wiederholter Header über >50% der Seiten wird entfernt
- [ ] Footer mit Seitenzahl wird entfernt
- [ ] Kein Header-Footer bei nur 1-2 Seiten
- [ ] Text zwischen Header und Footer bleibt erhalten

#### Boilerplate-Entfernung

- [ ] Copyright-Zeile wird entfernt
- [ ] Cookie-Notice wird entfernt
- [ ] "All rights reserved" wird entfernt
- [ ] Normaler Text bleibt unverändert

#### Kapitelerkennung

- [ ] "Chapter 1" wird als Kapitel erkannt
- [ ] "Kapitel 2: Einführung" wird erkannt
- [ ] "1. Introduction" wird erkannt
- [ ] Seitenzahl wird NICHT als Kapitel erkannt
- [ ] "IV. Results" wird erkannt

#### Qualitätsfilter

- [ ] Block mit 50 Zeichen wird verworfen
- [ ] Repetitiver Text wird verworfen
- [ ] Code-Block (<50% Buchstaben) wird verworfen
- [ ] Normaler Fließtext bleibt erhalten

#### Integration

- [ ] `process()` gibt korrekte Statistiken zurück
- [ ] PDF-Durchlauf: Headers + Chapters + Quality
- [ ] HTML-Durchlauf: Boilerplate + Quality
- [ ] EPUB-Durchlauf: nur Quality (kein Header/Footer)

### Testdaten

Erstelle Test-Fixtures:

- `tests/fixtures/pdf_with_headers.txt` (simulierter PDF-Text mit wiederholten Headern)
- `tests/fixtures/html_with_boilerplate.txt` (simulierter HTML-Text mit Cookie-Banner)
- `tests/fixtures/multi_chapter_text.txt` (Text mit mehreren Kapitelüberschriften)

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/text-preprocessor.ts` | **Neu** |
| `src/universal-extractor.ts` | Ändern (Preprocessor integrieren) |
| `src/config.ts` | Ändern (Preprocessing-Optionen) |
| `src/index.ts` | Ändern (neue Exports) |
| `tests/text-preprocessor.test.ts` | **Neu** |
| `tests/fixtures/pdf_with_headers.txt` | **Neu** |
| `tests/fixtures/html_with_boilerplate.txt` | **Neu** |
| `tests/fixtures/multi_chapter_text.txt` | **Neu** |
