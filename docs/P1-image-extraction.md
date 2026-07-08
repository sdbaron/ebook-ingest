<!-- markdownlint-disable MD024 -->

# P1 – Bild-Extraktion und Vault-Einbettung

> **Ziel:** Bilder aus Quellen (EPUB, FB2) während des Imports **kopieren**
> statt nur referenzieren — in einen stabilen Attachment-Ordner
> `06_attachments/<source-slug>/` im Vault. Die extrahierten Bilder werden
> über Obsidian-native Wikilinks (`![[pfad]]`) in den Markdown-Notizen
> referenziert. Dadurch wird der Vault vollständig autark und portabel.

| --- |

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | `EbookIngestConfig` um `attachmentsDir` erweitern | 15 min |
| 2 | `EpubImageExtractor` – Bilder aus EPUB extrahieren | 1,5 h |
| 3 | `Fb2ImageExtractor` – Bilder aus FB2 extrahieren | 1 h |
| 4 | Gemeinsame `ImageExtractor`-Schnittstelle + `extractImages()`-Factory | 30 min |
| 5 | Integration in `WikiPipeline` + `ObsidianWriter` | 1,5 h |
| 6 | Skalierungs-Strategie: Verkleinerung großer Bilder | 45 min |
| 7 | Test-Fixtures (EPUB mit Bild, FB2 mit Base64-Bild) | 30 min |
| 8 | Unit-Tests schreiben | 2 h |
| 9 | Dokumentation (README, CLI-Hilfe) | 30 min |

Gesamt: ~8,5 Stunden

> **Phase 2 (optional, nicht in dieser Aufgabe):** HTML/URL-Bildextraktion.
> Siehe Abschnitt »Bekannte Einschränkungen«.

| --- |

## Hintergrund: Warum kopieren statt referenzieren?

| Ansatz | Problem |
| ---   --- |
| Originalpfad behalten | `![](C:\Users\...\bild.png)` funktioniert in Obsidian nicht |
| Relativer Pfad zur Quelldatei | Quelle kann gelöscht/verschoben werden → Broken Links |
| Kopieren in den Vault | ✅ Vault bleibt autark, portabel, versionierbar |

| --- |

## Konzept

### Vorher (ohne Bild-Extraktion)

```text
05_sources/
  clean-architecture/
    01.md           ← nur Text, keine Bilder
    index.md
```

### Nachher (mit Bild-Extraktion)

```text
05_sources/
  clean-architecture/
    01.md           ← Text + ![[06_attachments/clean-architecture/fig-3-1.png]]
    index.md

06_attachments/
  clean-architecture/
    fig-3-1.png     ← kopiert aus EPUB
    diagram-dip.png ← kopiert aus EPUB
```

### Pipeline-Integration

```text
EPUB / FB2
     ↓
UniversalExtractor.extract()      ← Text-Blöcke (wie bisher)
     ↓
UniversalExtractor.extractImages() ← NEU: Bilder kopieren
     ↓
ObsidianWriter                       ← Schreibt ![[...]]-Links
```

| --- |

## Aufgabe 1: `EbookIngestConfig` um `attachmentsDir` erweitern

**Datei:** `src/config.ts`

```typescript
export interface EbookIngestConfig {
  // …existing…

  /** Directory for copied/extracted images */
  attachmentsDir: string;
}

export const defaultConfig: EbookIngestConfig = {
  // …existing…
  attachmentsDir: "06_attachments",
};
```

**Akzeptanzkriterien:**

- [ ] `defaultConfig.attachmentsDir` = `"06_attachments"`
- [ ] Typ ist im Interface definiert
- [ ] `loadConfig()` merged den Wert korrekt aus Config-Dateien

| --- |

## Aufgabe 2: `EpubImageExtractor` – Bilder aus EPUB extrahieren

**Neue Datei:** `src/epub-image-extractor.ts`

### Hintergrund: EPUB-Bildstruktur

EPUB-Dateien enthalten Bilder als separate Einträge im ZIP-Archiv.
Die `epub`-Bibliothek stellt zwei relevante Mechanismen bereit:

- `epub.manifest` – Liste aller Ressourcen mit `id`, `href` und `media-type`
- `epub.getImage(id, callback)` – Liefert Buffer + Mediatyp eines Bildes

Typische Media-Types: `image/jpeg`, `image/png`, `image/gif`, `image/svg+xml`

### Schnittstelle

```typescript
export interface ExtractedImage {
  /** Original-ID aus dem Quell-Manifest (z. B. "cover.jpg") */
  originalId: string;
  /** Dateiname im Zielverzeichnis (bereinigt) */
  fileName: string;
  /** Relativer Pfad vom Vault-Root zum kopierten Bild */
  vaultPath: string;
  /** MIME-Type (z. B. "image/png") */
  mimeType: string;
  /** Dateigröße in Bytes */
  sizeBytes: number;
}

export class EpubImageExtractor {
  /**
   * Extract all images from an EPUB file into a target directory.
   *
   * @param epubPath   Path to the .epub file
   * @param targetDir  Absolute path to the target directory
   *                   (e.g. /vault/06_attachments/source-slug/)
   * @param maxWidth   Optional: scale images wider than this (default: 1200)
   * @returns Array of extracted image metadata
   */
  static async extract(
    epubPath: string,
    targetDir: string,
    maxWidth?: number,
  ): Promise<ExtractedImage[]>;

  /**
   * Sanitize a filename: lowercase, replace non-alphanumeric with "-",
   * ensure unique name if collision.
   */
  private static sanitizeFileName(
    original: string,
    existingNames: Set<string>,
  ): string;

  /**
   * Map MIME type to file extension.
   */
  private static mimeToExtension(mimeType: string): string;
}
```

### Implementierungsvorlage

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import EPub from 'epub';
import sharp from 'sharp';  // ← neue Dependency für Skalierung

export class EpubImageExtractor {
  static async extract(
    epubPath: string,
    targetDir: string,
    maxWidth: number = 1200,
  ): Promise<ExtractedImage[]> {
    const epub = new EPub(epubPath);

    return new Promise<ExtractedImage[]>((resolve, reject) => {
      epub.on('end', async () => {
        try {
          // 1. Filtere manifest nach image/* Einträgen
          const imageEntries = Object.values(epub.manifest)
            .filter((entry: { 'media-type'?: string }) => {
              const mime = entry['media-type'] ?? '';
              return mime.startsWith('image/') && mime !== 'image/svg+xml';
            });

          if (imageEntries.length === 0) {
            resolve([]);
            return;
          }

          // 2. Stelle Zielverzeichnis sicher
          await fs.mkdir(targetDir, { recursive: true });

          const existingNames = new Set<string>();
          const results: ExtractedImage[] = [];

          for (const entry of imageEntries as Array<{
            id: string; href: string; 'media-type': string;
          }>) {
            try {
              const buffer: Buffer = await new Promise((res, rej) => {
                epub.getImage(entry.id, (err: Error | null, data: Buffer, mime: string) => {
                  if (err) rej(err);
                  else res(data);
                });
              });

              if (!buffer || buffer.length === 0) continue;

              // 3. Skaliere, falls nötig
              let finalBuffer = buffer;
              if (maxWidth > 0) {
                try {
                  const metadata = await sharp(buffer).metadata();
                  if (metadata.width && metadata.width > maxWidth) {
                    finalBuffer = await sharp(buffer)
                      .resize({ width: maxWidth, withoutEnlargement: true })
                      .toBuffer();
                  }
                } catch {
                  // sharp kann scheitern (z. B. bei GIF) — Original behalten
                }
              }

              // 4. Dateiname bereinigen
              const ext = EpubImageExtractor.mimeToExtension(
                entry['media-type'] ?? 'image/png',
              );
              const rawName = path.basename(
                (entry.href ?? entry.id ?? 'image'), ext,
              ).replace(new RegExp(`\\${ext}$`), '');

              const fileName = EpubImageExtractor.sanitizeFileName(
                rawName, existingNames,
              ) + ext;

              existingNames.add(fileName);

              // 5. Auf Platte schreiben
              const destPath = path.join(targetDir, fileName);
              await fs.writeFile(destPath, finalBuffer);

              results.push({
                originalId: entry.id,
                fileName,
                vaultPath: destPath,
                mimeType: entry['media-type'] ?? 'image/png',
                sizeBytes: finalBuffer.length,
              });
            } catch {
              // Einzelne Bilder können fehlschlagen — überspringen, nicht crashen
            }
          }

          resolve(results);
        } catch (err) {
          reject(err);
        }
      });

      epub.on('error', (err: Error) => {
        reject(new Error(`Failed to parse EPUB images: ${err.message}`));
      });

      epub.parse();
    });
  }

  private static sanitizeFileName(
    original: string,
    existingNames: Set<string>,
  ): string {
    let base = original
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'image';

    let candidate = base;
    let counter = 1;
    while (existingNames.has(candidate)) {
      candidate = `${base}-${counter}`;
      counter++;
    }
    return candidate;
  }

  private static mimeToExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
    };
    return map[mimeType] ?? '.png';
  }
}
```

### Neue npm-Dependency

```bash
pnpm add sharp
```

`sharp` ist die Standardbibliothek für Bildverarbeitung in Node.js (Resize,
Format-Konvertierung). Wird nur für die optionale Skalierung verwendet —
der Extractor funktioniert auch ohne `sharp` (dann ohne Resize).

**Akzeptanzkriterien:**

- [ ] `extract()` findet alle Bilder im EPUB-Manifest
- [ ] Bilder werden mit bereinigtem Dateinamen in `targetDir` geschrieben
- [ ] SVG-Bilder werden ignoriert (kein `sharp`-Support, nicht sinnvoll für Vault)
- [ ] Bilder > `maxWidth` werden skaliert (falls `sharp` installiert)
- [ ] Kollidierende Dateinamen erhalten Suffix (`-1`, `-2`, …)
- [ ] Einzelne fehlerhafte Bilder crashen nicht den gesamten Extrakt
- [ ] Leeres EPUB (keine Bilder) → `[]` (kein Fehler)

| --- |

## Aufgabe 3: `Fb2ImageExtractor` – Bilder aus FB2 extrahieren

**Neue Datei:** `src/fb2-image-extractor.ts`

### Hintergrund: FB2-Bildstruktur

FB2 bettet Bilder als Base64-kodierte `<binary>`-Elemente ein:

```xml
<FictionBook>
  <binary id="cover.jpg" content-type="image/jpeg">
    /9j/4AAQSkZJRgABAQEAYABgAAD...  ← Base64
  </binary>
</FictionBook>
```

Die Referenzierung erfolgt über `<image l:href="#cover.jpg"/>` im Fließtext.

### Schnittstelle

```typescript
export class Fb2ImageExtractor {
  /**
   * Extract all images from an FB2 file into a target directory.
   *
   * @param fb2Path   Path to the .fb2 file
   * @param targetDir Absolute path to the target directory
   * @param maxWidth  Optional: scale images wider than this (default: 1200)
   */
  static async extract(
    fb2Path: string,
    targetDir: string,
    maxWidth?: number,
  ): Promise<ExtractedImage[]>;
}
```

### Implementierungsvorlage

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

export class Fb2ImageExtractor {
  static async extract(
    fb2Path: string,
    targetDir: string,
    maxWidth: number = 1200,
  ): Promise<ExtractedImage[]> {
    // 1. Datei einlesen
    let xml: string;
    try {
      xml = await fs.readFile(fb2Path, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] Cannot read FB2 file for images: ${message}`);
      return [];
    }

    // 2. XML parsen
    const $ = cheerio.load(xml, { xmlMode: true });

    // 3. <binary>-Elemente finden
    const binaries = $('binary');
    if (binaries.length === 0) return [];

    // 4. Zielverzeichnis anlegen
    await fs.mkdir(targetDir, { recursive: true });

    const existingNames = new Set<string>();
    const results: ExtractedImage[] = [];

    binaries.each((_i, el) => {
      const $el = $(el);
      const id = $el.attr('id') ?? `image-${_i}`;
      const mimeType = $el.attr('content-type') ?? 'image/jpeg';
      const base64Data = $el.text().replace(/\s/g, '');

      if (!base64Data) return;

      try {
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length === 0) return;

        // Dateiendung aus MIME-Type
        const ext = mimeToExtension(mimeType);
        const rawName = path.basename(id, ext).replace(new RegExp(`\\${ext}$`), '');
        const fileName = sanitizeFileName(rawName, existingNames) + ext;
        existingNames.add(fileName);

        // Optional: Skalierung mit sharp (wie bei EPUB)
        // … (analog zu EpubImageExtractor)

        const destPath = path.join(targetDir, fileName);
        await fs.writeFile(destPath, buffer);

        results.push({
          originalId: id,
          fileName,
          vaultPath: destPath,
          mimeType,
          sizeBytes: buffer.length,
        });
      } catch {
        // Einzelnes Binary überspringen
      }
    });

    return results;
  }
}
```

**Akzeptanzkriterien:**

- [ ] Alle `<binary>`-Elemente mit gültigem Base64 werden extrahiert
- [ ] `content-type` wird korrekt auf Dateiendung gemappt
- [ ] Leere/ungültige Base64-Daten werden übersprungen
- [ ] FB2 ohne Bilder → `[]`
- [ ] Malformiertes XML → Warnung + `[]` (kein Crash)

| --- |

## Aufgabe 4: Gemeinsame `ImageExtractor`-Schnittstelle

### `ExtractedImage`-Interface

Das Interface wird in einer gemeinsamen Datei definiert oder in
`src/universal-extractor.ts` integriert, damit alle Extraktoren
denselben Rückgabetyp verwenden.

**Datei:** `src/universal-extractor.ts` (erweitern)

```typescript
// Am Anfang der Datei ergänzen:
export interface ExtractedImage {
  originalId: string;
  fileName: string;
  vaultPath: string;
  mimeType: string;
  sizeBytes: number;
}
```

### `extractImages()`-Methode im `UniversalExtractor`

```typescript
// Neue Methode in der UniversalExtractor-Klasse:
async extractImages(
  sourcePath: string,
  targetDir: string,
  maxWidth?: number,
): Promise<ExtractedImage[]> {
  const format = UniversalExtractor.detectFormat(sourcePath);

  switch (format) {
    case 'epub':
      return EpubImageExtractor.extract(sourcePath, targetDir, maxWidth);
    case 'fb2':
      return Fb2ImageExtractor.extract(sourcePath, targetDir, maxWidth);
    case 'pdf':
      console.warn(
        '[WARN] PDF image extraction is not supported yet.',
      );
      return [];
    case 'html':
    case 'url':
      console.warn(
        '[WARN] HTML/URL image extraction is planned for a future release.',
      );
      return [];
  }
}
```

**Akzeptanzkriterien:**

- [ ] `extractImages()` delegiert formatabhängig an den richtigen Extractor
- [ ] Nicht unterstützte Formate (PDF, HTML) warnen und geben `[]` zurück
- [ ] `ExtractionResult`-Interface bleibt unverändert (Bilder sind separat)

| --- |

## Aufgabe 5: Integration in `WikiPipeline` + `ObsidianWriter`

**Dateien:** `src/pipeline.ts`, `src/obsidian-writer.ts`

### `ObsidianWriter` – neue Methode

```typescript
/**
 * Build an Obsidian embed link for an extracted image.
 *
 * @param attachmentsDir  e.g. "06_attachments"
 * @param sourceName      e.g. "clean-architecture"
 * @param fileName        e.g. "fig-3-1.png"
 * @returns e.g. "![[06_attachments/clean-architecture/fig-3-1.png]]"
 */
static imageEmbed(
  attachmentsDir: string,
  sourceName: string,
  fileName: string,
): string;
```

### `WikiPipeline` – Integration

In `pipeline.ts` wird nach der Textextraktion und vor/nach dem Schreiben
der Blöcke die Bildextraktion aufgerufen:

```typescript
async ingest(sourcePath: string, sourceName: string, project: string, resume: boolean) {
  // … bestehende Extraktion …

  // NEU: Bilder extrahieren
  const attachmentsBase = path.resolve(this.config.vault, this.config.attachmentsDir);
  const imageTargetDir = path.join(attachmentsBase, sourceName);
  const images = await this.extractor.extractImages(sourcePath, imageTargetDir);

  if (images.length > 0) {
    console.log(`[IMAGES] Extracted ${images.length} images → ${imageTargetDir}`);

    // Einfügen einer Bild-Referenz-Sektion im Source-Index
    const imageEmbeds = images.map(img =>
      ObsidianWriter.imageEmbed(this.config.attachmentsDir, sourceName, img.fileName),
    );
    // imageEmbeds wird an writeSourceIndex() übergeben
  }

  // … bestehendes Schreiben …
}
```

**Wichtig:** Die Bild-Embeds werden im Source-Index (`index.md`) unter
einer neuen Sektion `## Images` aufgelistet. Die Zuordnung zu einzelnen
Blöcken (»Bild X gehört zu Kapitel Y«) ist eine optionale Erweiterung
für später.

**Akzeptanzkriterien:**

- [ ] `imageEmbed()` erzeugt korrekte `![[...]]`-Wikilinks
- [ ] Source-Index enthält `## Images`-Sektion mit Embeds (wenn Bilder vorhanden)
- [ ] Ohne Bilder: keine leere Images-Sektion, kein Fehler
- [ ] Pipeline crasht nicht bei fehlgeschlagener Bildextraktion

| --- |

## Aufgabe 6: Skalierungs-Strategie

### Problem

Originalbilder aus E-Books können sehr groß sein (mehrere MB, >2000 px breit).
Das bläht den Vault unnötig auf und verlangsamt Obsidian.

### Lösung

1. Neue Dependency `sharp` (schnelle native Bildverarbeitung)
2. Standard-Maximalbreite: **1200 px** (via `maxWidth`-Parameter)
3. `sharp`-Fehler werden silently ignoriert — Fallback auf Original
4. Keine Qualitätsreduktion für PNG (verlustfrei)
5. JPEG-Qualität: 85 % (guter Kompromiss)

**Akzeptanzkriterien:**

- [ ] Bilder > 1200 px breit werden auf 1200 px skaliert
- [ ] `sharp` nicht installiert → Originalbilder werden kopiert (Warnung)
- [ ] Skalierung ändert nicht das Seitenverhältnis
- [ ] PNG bleibt PNG, JPEG bleibt JPEG (keine Format-Konvertierung)

| --- |

## Aufgabe 7: Test-Fixtures

### `tests/fixtures/epub-with-images/`

Ein minimales EPUB 2.0 mit:

- 1 Cover-Image (JPEG, ~200×300 px)
- 1 Inline-Diagramm (PNG, ~800×600 px)
- `mimetype`-Datei, `META-INF/container.xml`, `content.opf`

> **Hinweis:** EPUB ist ein ZIP-Archiv. Das Fixture wird als Ordnerstruktur
> angelegt und im Test dynamisch als `.epub` gezippt (mit Node.js `adm-zip`
> oder `archiver` als devDependency, oder manuell).

### `tests/fixtures/sample-image.fb2`

Erweiterung der bestehenden `sample.fb2` um ein `<binary>`-Element:

```xml
<binary id="test-image.png" content-type="image/png">
  iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk
  +M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
</binary>
```

> Das ist ein 1×1 px graues PNG (minimales valides PNG).

**Akzeptanzkriterien:**

- [ ] EPUB-Fixture ist valide (lässt sich mit `epub`-Lib parsen)
- [ ] EPUB-Fixture enthält genau 2 Bilder
- [ ] FB2-Fixture enthält mindestens 1 `<binary>`-Element mit gültigem Base64

| --- |

## Aufgabe 8: Unit-Tests

**Neue Dateien:**

- `tests/epub-image-extractor.test.ts`
- `tests/fb2-image-extractor.test.ts`

### `epub-image-extractor.test.ts`

```typescript
describe('EpubImageExtractor', () => {
  it('extracts images from an EPUB with embedded images')
    → results.length >= 1, jedes Bild hat fileName, mimeType, sizeBytes > 0

  it('writes image files to the target directory')
    → fs.existsSync(destPath) === true

  it('sanitizes file names (spaces → hyphens, lowercase)')
    → fileName matches /^[a-z0-9-]+\.(png|jpg)$/

  it('returns empty array for EPUB without images')
    → results === []

  it('does not crash on malformed EPUB')
    → results === [] (console.warn ausgelöst)

  it('scales down images wider than maxWidth')
    → vorher > 1200 px → nachher ≤ 1200 px

  it('skips SVG images')
    → kein SVG im results-Array
});
```

### `fb2-image-extractor.test.ts`

```typescript
describe('Fb2ImageExtractor', () => {
  it('extracts base64-encoded image from <binary> element')
    → results.length === 1, sizeBytes > 0

  it('writes decoded image to target directory')
    → Datei existiert, ist valides PNG

  it('returns empty array for FB2 without <binary> elements')
    → results === []

  it('returns empty array for malformed base64')
    → kein Crash, leeres Array

  it('handles multiple <binary> elements')
    → results.length === Anzahl der <binary>-Elemente
});
```

**Akzeptanzkriterien:**

- [ ] Alle Tests aus der obigen Liste sind implementiert
- [ ] `pnpm test` läuft ohne Fehler
- [ ] Tests verwenden Temp-Verzeichnisse (`os.tmpdir()`) und räumen auf

| --- |

## Aufgabe 9: Dokumentation

**README.md:**

- Abschnitt »Features« um Bild-Extraktion ergänzen
- Abschnitt »Konfiguration« um `attachmentsDir` ergänzen
- Beispiel mit Bild-Extraktion dokumentieren

**CLI-Hilfe (`printUsage()`):**

Keine neuen CLI-Parameter nötig — die Bildextraktion läuft automatisch
beim `ingest`-Kommando.

| --- |

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion | Inhalt |
| --- | --- | --- |
| `src/epub-image-extractor.ts` | **Neu** | EPUB-Bildextraktion |
| `src/fb2-image-extractor.ts` | **Neu** | FB2-Bildextraktion |
| `src/universal-extractor.ts` | Ändern | `ExtractedImage`-Interface, `extractImages()` |
| `src/pipeline.ts` | Ändern | Integration in `ingest()` |
| `src/obsidian-writer.ts` | Ändern | `imageEmbed()`-Methode |
| `src/config.ts` | Ändern | `attachmentsDir` |
| `src/index.ts` | Ändern | Neue Exports |
| `package.json` | Ändern | `sharp`-Dependency |
| `tests/epub-image-extractor.test.ts` | **Neu** | EPUB-Tests |
| `tests/fb2-image-extractor.test.ts` | **Neu** | FB2-Tests |
| `tests/fixtures/epub-with-images/` | **Neu** | EPUB-Test-Fixture |
| `tests/fixtures/sample-image.fb2` | **Neu** | FB2-Test-Fixture |
| `README.md` | Ändern | Dokumentation |

**Neue npm-Dependency:** `sharp` (für optionale Bildskalierung)

| --- |

## Bekannte Einschränkungen (bewusst out of scope)

- **PDF-Bildextraktion:** `pdf-parse` extrahiert nur Text. Für
  Bild-Extraktion wäre `pdfjs-dist` nötig — separater Task (P2).
- **HTML/URL-Bildextraktion:** Relativ- und Absolute-URLs müssen
  aufgelöst werden, inkl. Timeout-Strategie — separater Task (P2).
- **Bild-zu-Block-Zuordnung:** In v1 werden alle Bilder unter
  `## Images` im Source-Index gesammelt. Die genaue Zuordnung
  »Bild X erscheint in Kapitel Y« folgt später.
- **SVG-Verarbeitung:** SVGs werden ignoriert (nicht sinnvoll
  als Einbettung in Markdown-Notizen).

| --- |

## Akzeptanzkriterien gesamt (Definition of Done)

- [ ] `pnpm test` — alle bestehenden + neue Image-Tests grün
- [ ] `pnpm build` — keine TypeScript-Fehler
- [ ] EPUB-Import kopiert Bilder nach `06_attachments/<source-slug>/`
- [ ] FB2-Import dekodiert Base64-Bilder und kopiert sie
- [ ] Source-Index enthält `## Images` mit `![[...]]`-Embeds
- [ ] Ohne Bilder: kein Fehler, keine leere Sektion
- [ ] Skalierung auf 1200 px funktioniert (mit `sharp`)
- [ ] Ohne `sharp`: Originalbilder werden kopiert, Warnung im Log
- [ ] `defaultConfig.attachmentsDir` = `"06_attachments"`
- [ ] Vault bleibt nach Bild-Extraktion vollständig portabel
