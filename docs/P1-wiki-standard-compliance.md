<!-- markdownlint-disable MD024 -->

# P1 – WIKI_CONTENT_STANDARD-Konformität für ebook-ingest

> **Ziel:** Alle von `ebook-ingest` erzeugten Notizen (Source-Index, Source-Block,
> Concept) erfüllen die Pflicht-Frontmatter-Anforderungen aus
> `WIKI_CONTENT_STANDARD.md`, sodass `packages/wiki-indexer` sie fehlerfrei
> indexiert und über MCP (`wiki_search`, `wiki_get_note`, `wiki_backlinks`)
> für Copilot auffindbar macht. Aktuell würde der Indexer nahezu jede von
> `ebook-ingest` erzeugte Notiz als Fehler protokollieren (fehlende
> Pflichtfelder, ungültiger `type`-Wert).

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | `EbookIngestConfig` um `wikiStandard`-Sektion erweitern | 30 min |
| 2 | Datums-Utility (ISO-Timestamp → `YYYY-MM-DD`) + Registry-Erweiterung | 30 min |
| 3 | Namens-Normalisierung (kebab-case für Verzeichnisse/Dateien) | 45 min |
| 4 | `ObsidianWriter.buildFrontmatter()` generalisieren (Type-Mapping, YAML-Escaping, Aliase/Sources) | 2,5 h |
| 5 | Domain- und Tag-Ableitung aus `project`/`source_type` | 45 min |
| 6 | `FrontmatterValidator` als Selbsttest vor dem Schreiben | 1 h |
| 7 | Migrations-Script für bestehende Notizen | 1,5 h |
| 8 | Unit-Tests schreiben | 1,5 h |
| 9 | Dokumentation aktualisieren | 30 min |

Gesamt: ~9,5 Stunden

---

## Hintergrund: Das Kompatibilitätsproblem

`WIKI_CONTENT_STANDARD.md` verlangt für **jede** indexierbare Notiz:

```yaml
title, type (concept|book|author|pattern|standard|decision|index),
domain, owner, created, updated, updated_at, tags (≥1), aliases
```

und definiert explizit: *„Notizen ohne gueltigen Frontmatter-Block werden
als Fehler protokolliert. Fehlende Pflichtfelder fuehren zu einem Fehler
fuer die betroffene Datei."*

`ebook-ingest` schreibt aktuell (siehe `P0-source-model.md`, Aufgabe 6):

```yaml
---
type: source_block
source: Clean_Architecture
source_type: epub
project: SoftwareArchitecture
---
```

| Anforderung | Status in ebook-ingest |
| --- | --- |
| `title` | ❌ fehlt |
| `type` (gültiger Enum-Wert) | ❌ `source_block`/`source` sind ungültig |
| `domain` | ❌ fehlt |
| `owner` | ❌ fehlt |
| `created` / `updated` / `updated_at` | ❌ fehlt (nur `ingested_at` in der Registry, nicht im Frontmatter) |
| `tags` | ❌ fehlt |
| `aliases` | ❌ fehlt |

Diese Aufgabe schließt die Lücke **auf Seiten von ebook-ingest**, ohne
`WIKI_CONTENT_STANDARD.md` selbst zu verändern.

---

## Konzept

### Vorher

```yaml
---
type: source_block
source: Clean_Architecture
source_type: epub
project: SoftwareArchitecture
---
```

### Nachher

```yaml
---
title: "Clean Architecture – Block 1"
type: book
domain: "software-architecture"
owner: "sergey"
created: "2026-06-19"
updated: "2026-06-19"
updated_at: "2026-06-19"
tags:
  - epub
  - software-architecture
aliases: []
sources: []
related: []
source: Clean_Architecture
source_type: epub
project: SoftwareArchitecture
---
```

Der Standard verbietet keine Zusatzfelder — `source`, `source_type` und
`project` bleiben erhalten, damit bestehende ebook-ingest-Logik
(Registry, Concept-Merge, Migration) unverändert weiterfunktioniert.

---

## Aufgabe 1: `EbookIngestConfig` um `wikiStandard`-Sektion erweitern

**Datei:** `src/config.ts`

```typescript
export type WikiNoteType =
  | 'concept' | 'book' | 'author' | 'pattern'
  | 'standard' | 'decision' | 'index';

export interface WikiStandardConfig {
  /** Frontmatter-Konformität aktivieren (default: true) */
  enabled: boolean;
  /** Owner-Kürzel für alle generierten Notizen (Single-User-Tool) */
  defaultOwner: string;
  /** Fallback-Domain, falls project nicht ableitbar ist */
  defaultDomain: string;
  /**
   * Mapping SourceFormat → WIKI_CONTENT_STANDARD type-Enum,
   * gilt NUR für Source-Block-Notizen (einzelne Kapitel/Blöcke).
   * Source-Index-Notizen sind immer `type: index`, Concept-Notizen
   * immer `type: concept` — beide fest codiert, siehe Aufgabe 4.
   */
  blockTypeMapping: Record<SourceFormat, WikiNoteType>;
}

export interface EbookIngestConfig {
  // …existing…
  wikiStandard: WikiStandardConfig;
}

export const defaultConfig: EbookIngestConfig = {
  // …existing…
  wikiStandard: {
    enabled: true,
    defaultOwner: 'unassigned',
    defaultDomain: 'general',
    blockTypeMapping: {
      epub: 'book',
      fb2: 'book',
      pdf: 'book',
      html: 'decision', // Platzhalter, siehe Hinweis unten
      url: 'decision',  // Platzhalter, siehe Hinweis unten
    },
  },
};
```

**Klärung: Welchen `type` bekommt welche Notiz-Art?** Ein einzelner
Kapitel-Block ist inhaltlich weder `book` (das ist die Quelle als
Ganzes) noch `concept`. Für v1 gilt Konvention **„Block gehört zu einem
Buch"** — vertretbar, da `book` im Standard breit genug gefasst ist:

| Notiz-Art | Methode | `type`-Wert | Herkunft |
| --- | --- | --- | --- |
| Source-Index | `writeSourceIndex()` | `index` | fest codiert |
| Source-Block | `writeSourceBlock()` | `blockTypeMapping[source_type]` | Config (Default: `book` für epub/fb2/pdf) |
| Concept | `updateConcept()` | `concept` | fest codiert |

**Hinweis:** `WIKI_CONTENT_STANDARD.md` kennt keinen Enum-Wert wie
`chapter`, `article` oder `note`. Für `html`/`url`-Quellen gibt es
keinen wirklich passenden Wert im bestehenden Enum — `decision` bleibt
Platzhalter. Eine Enum-Erweiterung um `chapter`/`note` wäre die
sauberere Lösung (Option B), liegt aber als Entscheidung beim
`wiki-llm-obsidian`-Projekt und **nicht** im Scope dieser Aufgabe.

### Akzeptanzkriterien

- [ ] `defaultConfig.wikiStandard.enabled` = `true`
- [ ] `blockTypeMapping` deckt alle 5 `SourceFormat`-Werte ab
- [ ] Source-Index und Concept nutzen die fest codierten Werte, nicht `blockTypeMapping`
- [ ] `defaultOwner`/`defaultDomain` sind per Config-Datei überschreibbar

---

## Aufgabe 2: Datums-Utility + Registry-Erweiterung

**Neue Datei:** `src/date-utils.ts`

```typescript
/** Convert an ISO-8601 timestamp to a YYYY-MM-DD date string. */
export function toDateOnly(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/** Today's date as YYYY-MM-DD, for `updated`/`updated_at`. */
export function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}
```

**Datei:** `src/knowledge-store.ts`

`SourceEntry` um `updated_at` erweitern:

```typescript
interface SourceEntry {
  project: string;
  source_type: SourceFormat;
  original_path: string;
  ingested_at: string; // ISO-8601, volle Präzision → wird zu `created`
  updated_at: string;  // ISO-8601, volle Präzision → wird zu `updated`/`updated_at`
}
```

Bei jedem `registerSource()`-Aufruf (auch bei `--resume` auf bereits
vorhandene Quellen): `ingested_at` bleibt unverändert, `updated_at` wird
neu gesetzt.

### Akzeptanzkriterien

- [ ] `toDateOnly()` liefert korrektes `YYYY-MM-DD`
- [ ] `registerSource()` aktualisiert `updated_at` bei jedem Aufruf
- [ ] `created` (abgeleitet aus `ingested_at`) bleibt bei erneutem Ingest unverändert

---

## Aufgabe 3: Namens-Normalisierung (kebab-case)

**Neue Datei:** `src/source-slug.ts` (analog zu `concept-normalizer.ts`)

```typescript
export class SourceSlug {
  /**
   * "Clean Architecture" → "clean-architecture"
   * "Release It! 2nd Ed." → "release-it-2nd-ed"
   */
  static toKebabCase(name: string): string;
}
```

**Wichtig:** Das betrifft nur Verzeichnis-/Dateinamen. Das `title`-Feld
im Frontmatter bleibt der lesbare Originalname.

**Abwärtskompatibilität:** Bestehende Verzeichnisse (z. B.
`05_sources/Clean_Architecture/`) werden **nicht** automatisch
umbenannt — das würde bestehende Wikilinks brechen. Der Slug gilt nur
für **neue** Importe.

### Akzeptanzkriterien

- [ ] Leerzeichen, Sonderzeichen, Großbuchstaben werden korrekt normalisiert
- [ ] Mehrfache Bindestriche werden zusammengeführt
- [ ] Führende/folgende Bindestriche werden entfernt

---

## Aufgabe 4: `ObsidianWriter.buildFrontmatter()` generalisieren

**Datei:** `src/obsidian-writer.ts`

```typescript
interface WikiFrontmatterInput {
  title: string;
  wikiType: WikiNoteType;
  domain: string;
  owner: string;
  created: string;  // YYYY-MM-DD
  updated: string;  // YYYY-MM-DD
  tags: string[];
  aliases: string[];
  sources?: string[];   // Wikilinks, z. B. ["[[Clean_Architecture]]"]
  related?: string[];
  extra?: Record<string, string>; // eigene Felder: source, source_type, project
}

/** Baut einen WIKI_CONTENT_STANDARD-konformen YAML-Frontmatter-Block. */
static buildFrontmatter(input: WikiFrontmatterInput): string;
```

**YAML-Escaping ist Pflicht:** Buch- und Kapiteltitel enthalten häufig
Doppelpunkte (z. B. „Release It!: Design and Deploy Production-Ready
Software" oder Kapitel wie „Chapter 4: Stability Antipatterns"). Ein
unquotierter Doppelpunkt in einem YAML-Wert bricht das Frontmatter.
Jeder String-Wert muss vor dem Schreiben durch eine Quoting-Funktion:

```typescript
private static yamlQuote(value: string): string {
  if (/[:#"'\n]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
```

Integration:

- `writeSourceBlock()` → `wikiType = blockTypeMapping[sourceType]`, `title` = LLM-generierter Blocktitel
- `writeSourceIndex()` → `wikiType = 'index'`, `title` = Source-Name
- Concept-Writer (`updateConcept()`) → `wikiType = 'concept'`, `title` = Konzeptname

**Aliase/Sources (aus der bisherigen Aufgabe 6 übernommen):** Die
Merge-Engine (siehe `P1-concept-merge-engine.md`, Aufgabe 6) pflegt
bereits `aliases[]` in `concept_registry.json`. Dieses Feld wird beim
Aufruf von `buildFrontmatter()` für Concept-Notizen direkt als
`input.aliases` durchgereicht — inklusive der Quellen-Wikilinks, die
bisher nur im Body unter „Mentioned in" standen:

```yaml
---
title: "Single Responsibility Principle"
type: concept
domain: "software-architecture"
owner: "sergey"
tags: [concept]
aliases: [SRP]
sources:
  - "[[Clean_Architecture]]"
  - "[[Clean_Code]]"
related: []
---
```

Für Source-Notizen: `aliases` bleibt `[]`, außer der ursprüngliche
Dateiname (`original_path`-Basename) weicht deutlich vom `title` ab —
dann wird er als Alias übergeben. Diese Ableitung passiert direkt am
Aufrufort von `buildFrontmatter()`, nicht in einer separaten Methode —
dadurch entfällt eine zweite Schnittstelle, die sonst denselben
`WikiFrontmatterInput` erneut zusammenbauen müsste.

### Akzeptanzkriterien

- [ ] Alle 8 Pflichtfelder sind in jedem erzeugten Frontmatter-Block vorhanden
- [ ] `type` ist immer ein gültiger Enum-Wert aus `WIKI_CONTENT_STANDARD.md`
- [ ] Titel mit `:`, `"` oder führenden/folgenden Leerzeichen brechen das YAML nicht
- [ ] Bestehende Felder `source`/`source_type`/`project` bleiben zusätzlich erhalten
- [ ] Concept-Notizen übernehmen `aliases` aus der Merge-Registry
- [ ] Concept-Notizen befüllen `sources` mit Wikilinks
- [ ] Source-Notizen erhalten bei abweichendem Original-Dateinamen einen Alias

---

## Aufgabe 5: Domain- und Tag-Ableitung

**Dateien:** `src/pipeline.ts`, `src/obsidian-writer.ts`

Regeln:

1. `domain = SourceSlug.toKebabCase(project || config.wikiStandard.defaultDomain)`
2. `tags = [source_type, domain]` (mind. 1 Eintrag garantiert, da `source_type` immer gesetzt ist)
3. `owner = config.wikiStandard.defaultOwner` (einheitlich, kein Per-Notiz-Owner nötig)

### Akzeptanzkriterien

- [ ] `domain` ist nie leer
- [ ] `tags` hat immer ≥ 1 Eintrag
- [ ] Default-Projekt `"General"` ergibt `domain: "general"`

---

## Aufgabe 6: `FrontmatterValidator` als Selbsttest

**Neue Datei:** `src/frontmatter-validator.ts`

```typescript
export interface FrontmatterValidationResult {
  valid: boolean;
  errors: string[];
}

export class FrontmatterValidator {
  /**
   * Prüft ein Frontmatter-Objekt gegen die Regeln aus
   * WIKI_CONTENT_STANDARD.md — spiegelt die Validierung von
   * packages/wiki-indexer, damit ebook-ingest vor dem Schreiben
   * selbst prüfen kann.
   */
  static validate(frontmatter: Record<string, unknown>): FrontmatterValidationResult;
}
```

Geprüfte Regeln:

- `title`: string, nicht leer
- `type`: einer von `concept|book|author|pattern|standard|decision|index`
- `domain`, `owner`: string, nicht leer
- `created`, `updated`, `updated_at`: Format `^\d{4}-\d{2}-\d{2}$`
- `updated === updated_at`
- `tags`: Array, ≥ 1 Eintrag
- `aliases`: Array (leer erlaubt)

`pipeline.ts` ruft `FrontmatterValidator.validate()` nach jedem
Schreibvorgang auf und loggt eine Warnung (kein Crash) bei
Regelverstoß — Regressionen werden so sofort im Log sichtbar, statt
erst beim nächsten `wiki-indexer`-Lauf.

### Akzeptanzkriterien

- [ ] Validator erkennt alle in `WIKI_CONTENT_STANDARD.md` beschriebenen Fehlerfälle
- [ ] Pipeline loggt Warnung bei jedem nicht-konformen Frontmatter
- [ ] Keine False Positives bei korrekt erzeugtem Frontmatter

---

## Aufgabe 7: Migrations-Script für bestehende Notizen

**Datei:** `src/migrate-vault.ts` erweitern (oder neue Datei `src/migrate-wiki-standard.ts`)

Bereits importierte Quellen (z. B. „Release It", siehe frühere
Debugging-Session zu fehlenden Bildpfaden) haben noch kein konformes
Frontmatter. Ablauf pro Notiz in `05_sources/**/*.md` und
`02_concepts/*.md`:

1. Bestehendes Frontmatter parsen.
2. Fehlende Pflichtfelder ergänzen:
   - `title` ← Dateiname/Source-Name, falls nicht vorhanden
   - `type` ← Mapping `source_block` → `blockTypeMapping[source_type]`, `source` → `index`
   - `domain`, `owner` ← Config-Defaults
   - `created`/`updated`/`updated_at` ← Datei-`mtime` als Fallback (kein `ingested_at` in Altnotizen)
   - `tags`, `aliases` ← `[source_type]` bzw. `[]`
3. Datei nur überschreiben, wenn sich das Frontmatter tatsächlich ändert.

```bash
ebook-ingest migrate-wiki-standard --vault /pfad/zum/vault [--dry-run]
```

### Akzeptanzkriterien

- [ ] Migration ergänzt alle Pflichtfelder in bestehenden Notizen
- [ ] `--dry-run` verändert keine Dateien
- [ ] Bereits konforme Notizen werden übersprungen (idempotent)
- [ ] Migration crasht nicht bei fehlerhaftem/fehlendem Frontmatter

---

## Aufgabe 8: Unit-Tests

**Neue Dateien:**

- `tests/frontmatter-validator.test.ts`
- `tests/source-slug.test.ts`
- `tests/obsidian-writer.wiki-standard.test.ts`
- `tests/migrate-wiki-standard.test.ts`

### Testfälle

- [ ] `buildFrontmatter()` erzeugt alle Pflichtfelder korrekt
- [ ] **`buildFrontmatter()` mit Titel `"Chapter 4: Stability Antipatterns"`**
      → Ergebnis ist valides YAML (mit `js-yaml`/`yaml`-Parser re-parsen
      und `title` exakt zurückerhalten). Das ist der reale Praxisfall aus
      dem „Release It"-Buch (siehe frühere Debugging-Session) und damit
      der wichtigste Regressionstest dieser Aufgabe.
- [ ] `buildFrontmatter()` quotet Titel mit `"` und führenden/folgenden Leerzeichen korrekt
- [ ] `blockTypeMapping` liefert für alle 5 `SourceFormat`-Werte einen gültigen Enum-Wert
- [ ] `SourceSlug.toKebabCase()` normalisiert Sonderfälle (Umlaute, Satzzeichen, Mehrfach-Leerzeichen)
- [ ] `FrontmatterValidator`: alle Pflichtfeld-Fehlerfälle werden erkannt
- [ ] `FrontmatterValidator`: `updated !== updated_at` wird als Fehler erkannt
- [ ] Migration: fehlende Felder werden korrekt nachgetragen
- [ ] Migration: `--dry-run` schreibt nichts
- [ ] Migration: bereits konforme Datei bleibt unverändert (idempotent)

---

## Aufgabe 9: Dokumentation aktualisieren

**Datei:** `README.md`

- [ ] Abschnitt „Konfiguration" um `wikiStandard`-Optionen ergänzen
- [ ] Abschnitt „Features" um Hinweis auf `WIKI_CONTENT_STANDARD.md`-Kompatibilität ergänzen
- [ ] Neuer Kurzabschnitt „Kompatibilität mit wiki-llm-obsidian" mit Verweis auf die offene Enum-Frage (`html`/`url`)

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/config.ts` | Ändern (`wikiStandard`-Sektion) |
| `src/date-utils.ts` | **Neu** |
| `src/source-slug.ts` | **Neu** |
| `src/frontmatter-validator.ts` | **Neu** |
| `src/obsidian-writer.ts` | Ändern (`buildFrontmatter()`, YAML-Escaping, Aliase/Sources) |
| `src/knowledge-store.ts` | Ändern (`SourceEntry.updated_at`) |
| `src/pipeline.ts` | Ändern (Domain-/Tag-Ableitung, Validator-Aufruf) |
| `src/concept-merge-engine.ts` | Ändern (Aliase ins Frontmatter durchreichen) |
| `src/migrate-vault.ts` | Ändern (oder `src/migrate-wiki-standard.ts` **neu**) |
| `src/cli.ts` | Ändern (`migrate-wiki-standard`-Subcommand) |
| `README.md` | Ändern |
| `tests/frontmatter-validator.test.ts` | **Neu** |
| `tests/source-slug.test.ts` | **Neu** |
| `tests/obsidian-writer.wiki-standard.test.ts` | **Neu** |
| `tests/migrate-wiki-standard.test.ts` | **Neu** |

---

## Bekannte Einschränkungen / offene Fragen

- Der `type`-Enum aus `WIKI_CONTENT_STANDARD.md` hat keinen passenden
  Wert für `html`/`url`-Quellen. `decision` wird als konfigurierbarer
  Platzhalter genutzt — eine Enum-Erweiterung liegt außerhalb des
  Scopes dieser Aufgabe.
- `domain`/`owner` sind global pro Tool-Instanz, nicht pro Notiz —
  für ein Single-User-Setup ausreichend.
- Bestehende Verzeichnisnamen werden nicht automatisch auf kebab-case
  migriert, um bestehende Wikilinks nicht zu brechen.
- Governance-/Exclude-Regeln (P3-04 in `wiki-llm-obsidian`) sind
  unabhängig hiervon weiterhin offen und nicht Teil dieser Aufgabe.

---

## Hinweis zur Reihenfolge

Diese Aufgabe baut auf **P0 – Source-Modell** und **P1 – Concept Merge
Engine** auf, da Domain-Ableitung (`project`) und Alias-Befüllung
(Merge-Registry) auf deren Datenmodellen basieren.
