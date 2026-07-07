<!-- markdownlint-disable MD024 -->

# P1 – Concept Merge Engine

> **Ziel:** Automatische Erkennung und Zusammenführung von Synonym-Konzepten.
> Z. B. `SRP` und `Single_Responsibility_Principle` werden als dasselbe Konzept erkannt
> und können manuell oder automatisch gemerged werden.

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | `ConceptMergeEngine`-Klasse entwerfen | 1 h |
| 2 | Exakte Duplikat-Erkennung implementieren | 30 min |
| 3 | Normalisierungs-Pipeline bauen | 1 h |
| 4 | LLM-basierte Ähnlichkeitsprüfung | 1,5 h |
| 5 | Merge-Operation implementieren | 1 h |
| 6 | `concept_registry.json` um Aliase erweitern | 30 min |
| 7 | CLI-Befehl `merge-concepts` bauen | 1 h |
| 8 | `--dry-run` und interaktiver Modus | 1 h |
| 9 | Unit-Tests schreiben | 1,5 h |

Gesamt: ~9 Stunden

---

## Konzept

### Das Problem

Nach der Analyse mehrerer Quellen entstehen Duplikate im Concept-Graph:

```text
02_concepts/
├── SRP.md                          (aus Clean Architecture)
├── Single_Responsibility_Principle.md  (aus Clean Code)
├── Dependency_Inversion.md
├── DIP.md                          (aus Agile Principles)
└── Dependency_Inversion_Principle.md
```

### Die Lösung

Eine Engine, die Kandidaten-Paare identifiziert und merging vorschlägt:

```text
🤖 Concept Merge Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Found 3 potential merge candidates:

[1] SRP ↔ Single_Responsibility_Principle (score: 0.95)
    → Keep: "Single_Responsibility_Principle"
    → Alias: "SRP"
    
[2] Dependency_Inversion ↔ DIP (score: 0.92)
    → Keep: "Dependency_Inversion"
    → Alias: "DIP"

Merge all? [Y/n/skip/select]: 
```

---

## Aufgabe 1: `ConceptMergeEngine`-Klasse entwerfen

**Neue Datei:** `src/concept-merge-engine.ts`

### Schnittstelle

```typescript
export interface MergeCandidate {
  /** The concept names that are candidates for merging */
  concepts: [string, string];
  /** Similarity score (0–1), higher = more similar */
  score: number;
  /** Method that found this match */
  method: 'exact_normalized' | 'llm_semantic' | 'acronym';
  /** Suggested primary name (the longer/more descriptive one) */
  suggestedPrimary: string;
  /** Suggested alias (the shorter/abbreviated one) */
  suggestedAlias: string;
}

export interface MergeResult {
  /** The primary concept name that was kept */
  primary: string;
  /** Concepts that were merged into the primary */
  merged: string[];
  /** Aliases registered */
  aliases: string[];
}

export class ConceptMergeEngine {
  constructor(private conceptDir: string, private llmAnalyzer?: LLMAnalyzer);

  /**
   * Find all merge candidates across the concept directory.
   * Returns candidates sorted by score (highest first).
   */
  async findCandidates(): Promise<MergeCandidate[]>;

  /**
   * Execute a merge: combine files, update registry, update links.
   */
  async merge(candidates: MergeCandidate[]): Promise<MergeResult[]>;

  /**
   * Check if two concept names refer to the same thing using LLM.
   */
  private async llmSimilarityCheck(a: string, b: string): Promise<number>;
}
```

### Akzeptanzkriterien
- [ ] Interface ist vollständig definiert
- [ ] `findCandidates()` gibt nach Score sortierte Kandidaten zurück
- [ ] `merge()` führt die tatsächliche Zusammenführung durch

---

## Aufgabe 2: Exakte Duplikat-Erkennung (nach Normalisierung)

### Algorithmus

1. Lade alle Konzepte aus `02_concepts/`.
2. Normalisiere jeden Namen mit `ConceptNormalizer.normalize()`.
3. Vergleiche jedes Paar — wenn normalisierte Namen identisch sind → `score: 1.0`, `method: 'exact_normalized'`.

### Beispiel

```text
"Single Responsibility Principle" → normalize → "Single_Responsibility_Principle"
"single-responsibility-principle" → normalize → "Single_Responsibility_Principle"
→ MATCH (score: 1.0)
```

### Implementierung in `findCandidates()`

```typescript
private findExactMatches(concepts: string[]): MergeCandidate[] {
  const normalized = new Map<string, string>();
  const candidates: MergeCandidate[] = [];

  for (const concept of concepts) {
    const norm = ConceptNormalizer.normalize(concept).toLowerCase();
    if (normalized.has(norm)) {
      candidates.push({
        concepts: [normalized.get(norm)!, concept],
        score: 1.0,
        method: 'exact_normalized',
        suggestedPrimary: concept.length > normalized.get(norm)!.length 
          ? concept : normalized.get(norm)!,
        suggestedAlias: concept.length > normalized.get(norm)!.length 
          ? normalized.get(norm)! : concept,
      });
    } else {
      normalized.set(norm, concept);
    }
  }
  return candidates;
}
```

### Akzeptanzkriterien
- [ ] Identische Konzepte nach Normalisierung werden erkannt
- [ ] Score ist 1.0 für exakte Matches
- [ ] Suggested primary ist der längere/deskriptivere Name

---

## Aufgabe 3: Akronym-Erkennung

### Algorithmus

1. Für jedes Konzept, das nur aus Großbuchstaben besteht (z. B. `SRP`, `DIP`):
2. Suche nach Konzepten, deren initialen Großbuchstaben das Akronym bilden:
   - `S`ingle `R`esponsibility `P`rinciple → `SRP` ✓
3. Score: `0.9` (hoch, aber nicht 1.0 — könnte falsch-positiv sein).

### Implementierung

```typescript
private findAcronymMatches(concepts: string[]): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  const acronyms = concepts.filter(c => /^[A-Z]{2,6}$/.test(c));
  const multiWord = concepts.filter(c => c.includes('_') || c.includes(' '));

  for (const acronym of acronyms) {
    const letters = acronym.split('');
    for (const candidate of multiWord) {
      const words = candidate.split(/[_\s]+/);
      if (words.length === letters.length) {
        const derived = words.map(w => w[0]?.toUpperCase() || '').join('');
        if (derived === acronym) {
          candidates.push({
            concepts: [acronym, candidate],
            score: 0.9,
            method: 'acronym',
            suggestedPrimary: candidate,
            suggestedAlias: acronym,
          });
        }
      }
    }
  }
  return candidates;
}
```

### Akzeptanzkriterien
- [ ] `SRP` ↔ `Single_Responsibility_Principle` wird erkannt
- [ ] `DIP` ↔ `Dependency_Inversion_Principle` wird erkannt
- [ ] Falsch-positive werden durch Score < 1.0 markiert

---

## Aufgabe 4: LLM-basierte semantische Ähnlichkeitsprüfung

### Konzept

Für Konzepte, die weder exakt noch per Akronym matchen, aber ähnlich klingen,
wird das LLM befragt:

```text
Prompt: "Are these two technical concepts the same thing?
Answer ONLY with a JSON: {"same": true/false, "confidence": 0.0-1.0}

Concept A: Dependency Inversion
Concept B: Inversion of Control"
```

### Effizienz-Strategie

- **Nicht alle Paare** vergleichen (O(n²) wäre zu teuer).
- Nur Konzepte vergleichen, die:
  1. Einen gemeinsamen signifikanten Wortstamm haben (z. B. beide enthalten "Dependency")
  2. Oder ähnliche Länge (±30%) und mindestens 50% gemeinsame Zeichen

### Implementierung

```typescript
private async findSemanticMatches(concepts: string[]): Promise<MergeCandidate[]> {
  const candidates: MergeCandidate[] = [];
  const pairs = this.filterCandidatePairs(concepts); // Pre-filtering

  for (const [a, b] of pairs) {
    const score = await this.llmSimilarityCheck(a, b);
    if (score > 0.7) {
      candidates.push({
        concepts: [a, b],
        score,
        method: 'llm_semantic',
        suggestedPrimary: a.length >= b.length ? a : b,
        suggestedAlias: a.length >= b.length ? b : a,
      });
    }
  }
  return candidates;
}

private filterCandidatePairs(concepts: string[]): [string, string][] {
  // Pre-filter: only compare concepts with shared word stems
  // or significant character overlap
  const pairs: [string, string][] = [];
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      if (this.hasSharedStem(concepts[i], concepts[j])) {
        pairs.push([concepts[i], concepts[j]]);
      }
    }
  }
  return pairs;
}
```

### Akzeptanzkriterien
- [ ] LLM-basierte Ähnlichkeit wird für gefilterte Kandidaten-Paare aufgerufen
- [ ] Nicht alle Paare werden verglichen (Performance)
- [ ] Score > 0.7 führt zu einem Merge-Vorschlag
- [ ] LLM-Fehler werden sauber behandelt (Timeout, ungültiges JSON)

---

## Aufgabe 5: Merge-Operation implementieren

### `merge()`-Methode

Führt die tatsächliche Zusammenführung durch:

1. **Datei behalten:** Die Datei des `suggestedPrimary` bleibt erhalten.
2. **Datei löschen/umbenennen:** Die Datei des `suggestedAlias` wird zu einer Redirect-Seite:
   ```markdown
   ---
   type: concept_redirect
   redirect_to: Single_Responsibility_Principle
   ---
   # SRP
   
   > This concept has been merged into [[Single_Responsibility_Principle]].
   ```
3. **Registry aktualisieren:**
   - `concept_registry.json`: Eintrag des Alias entfernen, seine `sources` zum Primary hinzufügen.
   - Neues Feld `aliases` zum Primary-Eintrag hinzufügen.
4. **Links aktualisieren:**
   - Alle `[[SRP]]`-Links in Kapitel- und Konzept-Dateien durch `[[Single_Responsibility_Principle|SRP]]` ersetzen.

### Implementierung

```typescript
async merge(candidates: MergeCandidate[]): Promise<MergeResult[]> {
  const results: MergeResult[] = [];

  for (const candidate of candidates) {
    const primary = candidate.suggestedPrimary;
    const alias = candidate.suggestedAlias;

    // 1. Merge concept file: create redirect from alias to primary
    await this.createRedirect(alias, primary);

    // 2. Merge registry entries
    await this.mergeRegistryEntries(primary, alias);

    // 3. Update all wikilinks in the vault
    await this.updateLinks(alias, primary);

    results.push({
      primary,
      merged: [alias],
      aliases: [alias],
    });
  }

  return results;
}
```

### Akzeptanzkriterien
- [ ] Primary-Datei bleibt unverändert (behält ihre Definition)
- [ ] Alias-Datei wird zu einem Redirect
- [ ] Registry wird korrekt aktualisiert (Sources zusammengeführt)
- [ ] Alle `[[Alias]]`-Links werden zu `[[Primary|Alias]]`
- [ ] Keine hängenden Links nach dem Merge

---

## Aufgabe 6: `concept_registry.json` um Aliase erweitern

### Neues Schema

```json
{
  "Single_Responsibility_Principle": {
    "sources": ["Clean_Architecture", "Clean_Code"],
    "aliases": ["SRP"],
    "merged_from": ["SRP"]
  },
  "SRP": null
}
```

- `aliases`: Liste der bekannten Alias-Namen für dieses Konzept.
- `merged_from`: Liste der ursprünglichen Namen, die in dieses Konzept gemerged wurden.
- Gemergte Einträge werden auf `null` gesetzt (oder entfernt) — sie existieren nicht mehr als eigenständige Konzepte.

### Code-Änderungen

- `KnowledgeStore.registerConcept()` prüft vor dem Anlegen, ob der Name ein Alias eines existierenden Konzepts ist.
- Wenn ja: Quelle wird zum Primary-Konzept hinzugefügt, kein neuer Eintrag erstellt.

### Akzeptanzkriterien
- [ ] Registry-Schema unterstützt `aliases` und `merged_from`
- [ ] `registerConcept` erkennt Aliase und leitet um
- [ ] Gemergte Konzepte erscheinen nicht in der globalen MOC

---

## Aufgabe 7: CLI-Befehl `merge-concepts` bauen

**Datei:** `src/cli.ts` (erweitern)

### Neuer Subcommand

```bash
ebook-ingest merge-concepts [--dry-run] [--auto] [--vault <path>]
```

Optionen:
- `--dry-run`: Nur anzeigen, nicht ausführen.
- `--auto`: Alle Kandidaten mit Score > 0.9 automatisch mergen (kein Prompt).
- `--vault`: Pfad zum Vault (sonst Default-Config).

### Ablauf

1. `ConceptMergeEngine.findCandidates()` aufrufen.
2. Kandidaten in einer formatierten Tabelle anzeigen.
3. Wenn nicht `--auto`: User fragen (interaktiv).
4. `merge()` ausführen.
5. Zusammenfassung ausgeben.

### Akzeptanzkriterien
- [ ] `merge-concepts` listet alle Kandidaten auf
- [ ] `--dry-run` zeigt nur an
- [ ] `--auto` merged ohne Nachfrage
- [ ] Interaktiver Modus fragt pro Kandidat

---

## Aufgabe 8: `--dry-run` und interaktiver Modus

### Dry-Run

Zeigt an, was passieren würde:

```text
🤖 Concept Merge Engine — DRY RUN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] SRP → Single_Responsibility_Principle
    Action: CREATE redirect 02_concepts/SRP.md → [[Single_Responsibility_Principle]]
    Action: MERGE sources: Clean_Architecture, Clean_Code
    Action: UPDATE links in 3 files

[2] DIP → Dependency_Inversion
    Action: CREATE redirect 02_concepts/DIP.md → [[Dependency_Inversion]]
    Action: MERGE sources: Clean_Architecture
    Action: UPDATE links in 2 files

No changes made (dry run).
```

### Interaktiver Modus

```text
Merge [1] SRP → Single_Responsibility_Principle? [Y/n/skip/all]: 
```

- `Y` = diesen mergen
- `n` = diesen überspringen
- `skip` = diesen + alle weiteren überspringen
- `all` = diesen + alle weiteren mergen

### Akzeptanzkriterien
- [ ] Dry-Run zeigt alle geplanten Aktionen
- [ ] Interaktiver Modus hat Y/n/skip/all
- [ ] Keine Dateien werden bei Dry-Run verändert

---

## Aufgabe 9: Unit-Tests schreiben

**Neue Datei:** `tests/concept-merge-engine.test.ts`

### Testfälle

- [ ] `findExactMatches`: Identisch nach Normalisierung → Score 1.0
- [ ] `findExactMatches`: Unterschiedliche Konzepte → kein Match
- [ ] `findAcronymMatches`: `SRP` ↔ `Single_Responsibility_Principle` → Score 0.9
- [ ] `findAcronymMatches`: `ABC` ↔ `Single_Responsibility_Principle` → kein Match
- [ ] `merge`: Alias-Datei wird zu Redirect
- [ ] `merge`: Registry wird korrekt aktualisiert
- [ ] `merge`: Links werden aktualisiert
- [ ] `merge`: Quellen werden zusammengeführt
- [ ] `llmSimilarityCheck`: Mock-LLM gibt korrekten Score zurück
- [ ] `filterCandidatePairs`: Nur relevante Paare werden verglichen

### Test-Setup

- Temporäres Vault-Verzeichnis mit Testdaten anlegen.
- Nach jedem Test aufräumen (`beforeEach`/`afterEach`).
- LLM-Aufrufe mocken für deterministische Tests.

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/concept-merge-engine.ts` | **Neu** |
| `src/cli.ts` | Ändern (merge-concepts Subcommand) |
| `src/knowledge-store.ts` | Ändern (Alias-Erkennung in registerConcept) |
| `src/obsidian-writer.ts` | Ändern (Redirect-Dateien, Link-Update) |
| `src/registry-manager.ts` | Ggf. Ändern (aliases Feld) |
| `src/index.ts` | Ändern (neue Exports) |
| `tests/concept-merge-engine.test.ts` | **Neu** |

---

## Hinweis zur Reihenfolge

Diese Aufgabe baut auf **P0 – Source-Modell** auf. Das Source-Modell sollte zuerst
implementiert sein, da die Merge-Engine mit `sources[]` statt `books[]` arbeitet.
