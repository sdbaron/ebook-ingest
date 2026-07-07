# P3 – Auto MOC Clustering

> **Ziel:** Maps of Content (MOCs) automatisch aus Concept-Embeddings generieren.
> Konzepte werden thematisch gruppiert, sodass zusammenhängende Themen automatisch
> eine gemeinsame Übersichtsseite erhalten — ohne manuelle Pflege.

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | Concept-Embeddings generieren | 1 h |
| 2 | Clustering-Algorithmus implementieren | 1,5 h |
| 3 | Cluster-Labels via LLM generieren | 1 h |
| 4 | MOC-Dateien aus Clustern schreiben | 1 h |
| 5 | Cluster-Visualisierung (ASCII-Graph) | 45 min |
| 6 | CLI-Befehl `generate-mocs` bauen | 1 h |
| 7 | Inkrementelles Update (neue Konzepte) | 1 h |
| 8 | Unit-Tests schreiben | 1 h |

**Gesamt: ~8 Stunden**

---

## Konzept

### Vorher (manuell)

```markdown
# Software Engineering           ← manuell geschrieben
## Concepts
- [[Dependency_Inversion]]
- [[Single_Responsibility]]
- [[Coupling]]
- [[Cohesion]]
- [[Design_Patterns]]
```

### Nachher (automatisch)

```
Konzepte → Embeddings → Clustering → Auto MOCs:

04_mocs/
├── Software_Architecture.md      ← Cluster 1 (auto-generiert)
├── Design_Principles.md          ← Cluster 2
├── Testing.md                    ← Cluster 3
└── Knowledge.md                  ← Global MOC (alle Konzepte)
```

### Clustering-Visualisierung

```
                    ┌──────────────────┐
                    │ Dependency_Inversion │
                    └───────┬──────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼──────────┐ ┌──────▼──────┐ ┌─────────▼─────────┐
│ Single_Resp.     │ │ Coupling    │ │ Inversion_of_Cont. │
└──────────────────┘ └─────────────┘ └───────────────────┘
        │                                        │
        └────────────┬───────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │ Design_Principles   │  ← Auto MOC
          └─────────────────────┘
```

---

## Aufgabe 1: Concept-Embeddings generieren

**Neue Datei:** `src/moc-generator.ts` (Teil 1)

### Konzept

Jedes Konzept bekommt ein Embedding basierend auf seiner Definition und den
verlinkten Quellen. Das Embedding repräsentiert die semantische Bedeutung des Konzepts.

```typescript
export interface ConceptVector {
  conceptName: string;
  embedding: number[];
  definition: string;
  sourceCount: number;
}

export class MocGenerator {
  constructor(
    private embeddingGenerator: EmbeddingGenerator,
    private conceptsDir: string,
  );

  /**
   * Generate embeddings for all concepts in the vault.
   */
  async vectorizeConcepts(): Promise<ConceptVector[]>;

  /**
   * Build a rich text representation of a concept for embedding.
   */
  private buildConceptText(conceptName: string): Promise<string>;
}
```

### `buildConceptText`

Liest die Konzept-Datei und baut einen repräsentativen Text:

```typescript
private async buildConceptText(conceptName: string): Promise<string> {
  const conceptPath = path.resolve(this.conceptsDir, `${conceptName}.md`);
  
  let content: string;
  try {
    content = await fs.readFile(conceptPath, 'utf-8');
  } catch {
    return conceptName.replace(/_/g, ' ');
  }

  // Extrahiere Definition (zwischen "## Definition" und "## Mentioned in")
  const defMatch = content.match(/## Definition\n([\s\S]*?)(?=\n## |$)/);
  const definition = defMatch ? defMatch[1].trim() : '';

  // Extrahiere verlinkte Quellen
  const sourceMatch = content.match(/## Mentioned in\n([\s\S]*?)$/);
  const sources = sourceMatch 
    ? sourceMatch[1].split('\n').filter(l => l.startsWith('- [[')).join(' ')
    : '';

  return `${conceptName.replace(/_/g, ' ')}: ${definition} ${sources}`;
}
```

**Akzeptanzkriterien:**
- [ ] Alle Konzepte im Vault werden vektorisiert
- [ ] Konzept-Text enthält Definition und Quellen
- [ ] Fehlende Konzepte werden übersprungen (mit Warnung)
- [ ] Leere Konzepte (nur Name) erhalten ein Embedding nur vom Namen

---

## Aufgabe 2: Clustering-Algorithmus implementieren

**Datei:** `src/moc-generator.ts` (Teil 2)

### Algorithmus-Wahl

**K-Means** ist einfach und effektiv für diesen Anwendungsfall. Die Anzahl der Cluster
wird entweder automatisch bestimmt (Elbow-Methode) oder manuell vorgegeben.

### Implementierung

```typescript
export interface ClusterResult {
  clusters: ConceptCluster[];
  /** Silhouette-Score zur Qualitätsbewertung (0–1) */
  silhouetteScore: number;
}

export interface ConceptCluster {
  label: string;         // Wird später vom LLM generiert
  concepts: string[];    // Concept-Namen in diesem Cluster
  centroid: number[];    // Zentrum des Clusters
}

export class MocGenerator {
  /**
   * Cluster concepts into thematic groups.
   * @param concepts    Vectorized concepts
   * @param numClusters Number of clusters (auto if not specified)
   */
  cluster(
    concepts: ConceptVector[],
    numClusters?: number,
  ): ClusterResult;
}
```

### K-Means (vereinfacht)

```typescript
cluster(concepts: ConceptVector[], numClusters?: number): ClusterResult {
  const vectors = concepts.map(c => c.embedding);

  // Bestimme optimale Cluster-Anzahl (Elbow-Methode)
  if (!numClusters) {
    numClusters = this.findOptimalK(vectors);
  }

  // Initialisiere Centroids (k-means++)
  let centroids = this.initializeCentroids(vectors, numClusters);

  // Iterative Optimierung
  const maxIterations = 100;
  for (let iter = 0; iter < maxIterations; iter++) {
    // Schritt 1: Weise jeden Punkt dem nächsten Centroid zu
    const assignments = vectors.map(v => this.closestCentroid(v, centroids));

    // Schritt 2: Berechne neue Centroids
    const newCentroids = this.recomputeCentroids(vectors, assignments, numClusters);

    // Prüfe Konvergenz
    if (this.centroidsEqual(centroids, newCentroids)) {
      break;
    }
    centroids = newCentroids;
  }

  // Baue Cluster-Objekte
  const assignments = vectors.map(v => this.closestCentroid(v, centroids));
  const clusters = this.buildClusters(concepts, assignments, centroids);

  // Berechne Silhouette-Score
  const silhouetteScore = this.calculateSilhouette(vectors, assignments, centroids);

  return { clusters, silhouetteScore };
}
```

### Cosine-Ähnlichkeit

```typescript
private cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### Elbow-Methode (automatische K-Bestimmung)

```typescript
private findOptimalK(vectors: number[][], maxK: number = 10): number {
  const distortions: number[] = [];

  for (let k = 1; k <= Math.min(maxK, vectors.length); k++) {
    // Führe K-Means mit k Clustern durch und berechne Distortion
    const distortion = this.computeDistortion(vectors, k);
    distortions.push(distortion);
  }

  // Finde den "Elbow" (größte Krümmungsänderung)
  return this.findElbowPoint(distortions);
}
```

**Akzeptanzkriterien:**
- [ ] K-Means clustering funktioniert
- [ ] Anzahl Cluster wird automatisch bestimmt (Elbow-Methode)
- [ ] `numClusters` manuell überschreibbar
- [ ] Silhouette-Score wird berechnet
- [ ] Weniger als 3 Konzepte → keine Cluster (Fallback)

---

## Aufgabe 3: Cluster-Labels via LLM generieren

**Datei:** `src/moc-generator.ts` (Teil 3)

### Konzept

Nachdem Konzepte geclustert wurden, bekommt jedes Cluster ein aussagekräftiges
Label vom LLM. Z. B. aus `[Dependency_Inversion, Coupling, Cohesion, SRP]` wird
`"Software Design Principles"`.

```typescript
private async generateClusterLabels(
  clusters: ConceptCluster[],
): Promise<void> {
  for (const cluster of clusters) {
    const conceptList = cluster.concepts
      .map(c => c.replace(/_/g, ' '))
      .join(', ');

    const prompt = `Given these related concepts:
${conceptList}

Suggest a short, descriptive category label (2-4 words) that best groups these concepts.
Return ONLY the label, nothing else.`;

    const response = await ollama.chat({
      model: this.llmModel,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0.3, num_predict: 20 },
    });

    cluster.label = response.message.content.trim();
  }
}
```

### Fallback (wenn LLM nicht verfügbar)

```typescript
private fallbackLabel(concepts: string[]): string {
  // Nimm den Namen des zentralsten Konzepts (nächst zum Centroid)
  // oder "Concept Group N"
  if (concepts.length === 0) return 'Empty Group';
  if (concepts.length === 1) return concepts[0].replace(/_/g, ' ');
  
  // Häufigste Wort-Wurzeln finden
  const words = concepts.flatMap(c => c.toLowerCase().split('_'));
  const freq = new Map<string, number>();
  words.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
  
  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));

  return topWords.join(' & ');
}
```

**Akzeptanzkriterien:**
- [ ] Jedes Cluster bekommt ein Label
- [ ] LLM-Labels sind aussagekräftig (2-4 Wörter)
- [ ] Fallback-Labels funktionieren ohne LLM
- [ ] Leere Cluster werden mit "Empty Group" gelabelt

---

## Aufgabe 4: MOC-Dateien aus Clustern schreiben

**Datei:** `src/moc-generator.ts` (Teil 4)

### MOC-Datei-Format

```markdown
---
type: moc
generated: 2026-06-19T10:00:00Z
cluster_size: 5
silhouette_score: 0.82
---

# Software Design Principles

> Auto-generated MOC — 5 concepts clustered together.

## Concepts

- [[Dependency_Inversion]]
- [[Single_Responsibility_Principle]]
- [[Coupling]]
- [[Cohesion]]
- [[Open_Closed_Principle]]

## Cluster Overview

| Concept | Sources |
| --- | --- |
| Dependency_Inversion | Clean_Architecture, Clean_Code |
| Single_Responsibility_Principle | Clean_Architecture, Agile_Principles |
| Coupling | Clean_Code |
| Cohesion | Clean_Code |
| Open_Closed_Principle | Agile_Principles |
```

### Implementierung

```typescript
async writeMocs(clusters: ConceptCluster[]): Promise<void> {
  const mocDir = path.resolve(this.vault, this.mocDir);
  await fs.mkdir(mocDir, { recursive: true });

  for (const cluster of clusters) {
    const fileName = cluster.label.replace(/[^A-Za-z0-9_ ]/g, '')
      .replace(/\s+/g, '_') + '.md';

    const conceptLinks = cluster.concepts
      .sort()
      .map(c => `- [[${c}]]`)
      .join('\n');

    const overview = await this.buildOverviewTable(cluster.concepts);

    const md = `---
type: moc
generated: ${new Date().toISOString()}
cluster_size: ${cluster.concepts.length}
silhouette_score: ${this.lastSilhouetteScore?.toFixed(2) || 'N/A'}
---

# ${cluster.label}

> Auto-generated MOC — ${cluster.concepts.length} concepts clustered together.

## Concepts

${conceptLinks}

## Cluster Overview

${overview}
`;

    await fs.writeFile(path.resolve(mocDir, fileName), md, 'utf-8');
    console.log(`[MOC] Generated: ${fileName} (${cluster.concepts.length} concepts)`);
  }
}
```

### Overview-Tabelle

```typescript
private async buildOverviewTable(concepts: string[]): Promise<string> {
  const registry = await RegistryManager.load(this.conceptRegistryPath);
  
  const rows = concepts.map(concept => {
    const entry = registry[concept] as { sources?: string[] } | undefined;
    const sourceList = entry?.sources?.join(', ') || '-';
    return `| ${concept.replace(/_/g, ' ')} | ${sourceList} |`;
  });

  return `| Concept | Sources |\n|---|---|\n${rows.join('\n')}`;
}
```

**Akzeptanzkriterien:**
- [ ] Jedes Cluster wird als MOC-Datei geschrieben
- [ ] MOC enthält Concept-Links und Overview-Tabelle
- [ ] Dateiname ist safe (keine Sonderzeichen)
- [ ] Bereits existierende MOCs werden überschrieben (mit Warnung)

---

## Aufgabe 5: Cluster-Visualisierung (ASCII-Graph)

### Konzept

Eine einfache Text-Visualisierung der Cluster für das Terminal:

```
🧠 Concept Clusters (Silhouette: 0.82)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─ Cluster 1: Software Design Principles (5 concepts) ─┐
│  ★ Dependency_Inversion                               │
│  ├─ Single_Responsibility_Principle                   │
│  ├─ Open_Closed_Principle                             │
│  ├─ Coupling                                          │
│  └─ Cohesion                                          │
└───────────────────────────────────────────────────────┘

┌─ Cluster 2: Testing (3 concepts) ─┐
│  ★ Unit_Testing                   │
│  ├─ Test_Driven_Development       │
│  └─ Integration_Testing           │
└────────────────────────────────────┘

┌─ Cluster 3: Architecture Patterns (4 concepts) ─┐
│  ★ Layered_Architecture                         │
│  ├─ Microservices                                │
│  ├─ Hexagonal_Architecture                       │
│  └─ Event_Driven                                 │
└──────────────────────────────────────────────────┘
```

### Implementierung

```typescript
visualizeClusters(clusters: ConceptCluster[]): string {
  let output = '\n🧠 Concept Clusters';
  if (this.lastSilhouetteScore) {
    output += ` (Silhouette: ${this.lastSilhouetteScore.toFixed(2)})`;
  }
  output += '\n' + '━'.repeat(50) + '\n\n';

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const concepts = cluster.concepts.slice(0, 8); // Max 8 anzeigen
    const more = cluster.concepts.length > 8 
      ? `\n│  ... and ${cluster.concepts.length - 8} more` 
      : '';

    output += `┌─ Cluster ${i + 1}: ${cluster.label} (${cluster.concepts.length} concepts) ─${'─'.repeat(Math.max(0, 40 - cluster.label.length))}┐\n`;
    output += `│  ★ ${concepts[0].replace(/_/g, ' ')}\n`;
    
    for (let j = 1; j < concepts.length; j++) {
      const isLast = j === concepts.length - 1 && !more;
      const prefix = isLast ? '└─' : '├─';
      output += `│  ${prefix} ${concepts[j].replace(/_/g, ' ')}\n`;
    }
    
    if (more) output += more + '\n';
    output += `└${'─'.repeat(60)}┘\n\n`;
  }

  return output;
}
```

**Akzeptanzkriterien:**
- [ ] Cluster werden als ASCII-Boxen dargestellt
- [ ] Zentrale Konzepte (★) werden hervorgehoben
- [ ] Große Cluster werden auf max. 8 Konzepte gekürzt
- [ ] Ausgabe ist in Monospace gut lesbar

---

## Aufgabe 6: CLI-Befehl `generate-mocs` bauen

**Datei:** `src/cli.ts` (erweitern)

```bash
ebook-ingest generate-mocs [options]

Options:
  --clusters <n>    Anzahl der Cluster (auto wenn nicht angegeben)
  --dry-run         Nur anzeigen, nicht schreiben
  --style <name>    Prompt-Template für Labels (default, academic, concise)
  --min-concepts <n> Minimale Anzahl Konzepte für MOC-Generierung (default: 3)
```

### Ausgabe

```
🧠 Auto MOC Generator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/3] Vectorizing 23 concepts...
[2/3] Clustering (auto-detected k=5)...
[3/3] Generating labels via LLM...

✅ Generated 5 MOCs:
  • Software Design Principles (5 concepts)
  • Testing & Quality (4 concepts)  
  • Architecture Patterns (6 concepts)
  • Data & Persistence (3 concepts)
  • Development Practices (5 concepts)

💡 Silhouette Score: 0.82 (good separation)
⚠ 3 concepts were too isolated to cluster (see 04_mocs/_unclustered.md)

Done! MOC files written to 04_mocs/
```

**Akzeptanzkriterien:**
- [ ] `generate-mocs` läuft ohne Fehler durch
- [ ] `--clusters 5` erzwingt 5 Cluster
- [ ] `--dry-run` zeigt Visualisierung ohne zu schreiben
- [ ] `--min-concepts 5` verhindert zu kleine MOCs
- [ ] Unclustered concepts werden dokumentiert

---

## Aufgabe 7: Inkrementelles Update

### Problem

Wenn neue Konzepte hinzukommen (durch neue Buch-Ingestion), müssen die MOCs
aktualisiert werden — aber nicht komplett neu generiert.

### Lösung

```typescript
async updateMocs(newConcepts?: string[]): Promise<void> {
  // 1. Bestehende MOC-Zuordnungen laden
  const existingMocs = await this.loadExistingMocs();

  // 2. Nur neue Konzepte vektorisieren
  const allConcepts = await this.getAllConcepts();
  const conceptsToVectorize = newConcepts 
    ? allConcepts.filter(c => newConcepts.includes(c.conceptName))
    : allConcepts;

  const newVectors = await this.vectorizeConcepts(conceptsToVectorize);

  // 3. Neue Konzepte dem nächsten bestehenden Cluster zuweisen
  //    Oder: neues Cluster erstellen, wenn Abstand zu groß
  for (const concept of newVectors) {
    const nearestCluster = this.findNearestCluster(concept, existingMocs);
    if (nearestCluster.distance < this.similarityThreshold) {
      nearestCluster.cluster.concepts.push(concept.conceptName);
    } else {
      // Zu weit entfernt → neues Cluster?
      unassignedConcepts.push(concept.conceptName);
    }
  }

  // 4. Aktualisierte MOCs schreiben
  await this.writeMocs(existingMocs);
  
  if (unassignedConcepts.length > 0) {
    console.log(`[MOC] ${unassignedConcepts.length} concepts could not be assigned to existing clusters.`);
    console.log('[MOC] Run `generate-mocs` to fully recluster.');
  }
}
```

### Integration in Pipeline

Nach jeder Ingestion automatisch `updateMocs()` aufrufen (optional, per Config):

```typescript
// In pipeline.ts, nach der Ingestion:
if (config.autoUpdateMocs) {
  const newConcepts = [...allConcepts]; // Die neu registrierten Konzepte
  await this.mocGenerator.updateMocs(newConcepts);
}
```

**Akzeptanzkriterien:**
- [ ] Neue Konzepte werden bestehenden Clustern zugewiesen
- [ ] Nur neue Konzepte werden neu vektorisiert (nicht alle)
- [ ] Zu weit entfernte Konzepte werden als "unclustered" markiert
- [ ] `generate-mocs` macht ein volles Reclustering

---

## Aufgabe 8: Unit-Tests schreiben

**Neue Datei:** `tests/moc-generator.test.ts`

### Testfälle

#### Clustering
- [ ] K-Means mit 5 Konzepten, 2 Clustern → korrekte Zuordnung
- [ ] Elbow-Methode findet sinnvolles K
- [ ] Silhouette-Score zwischen 0 und 1
- [ ] Weniger als 3 Konzepte → kein Clustering

#### Label-Generierung
- [ ] LLM-Label wird korrekt gesetzt
- [ ] Fallback-Label ohne LLM
- [ ] Leeres Cluster → "Empty Group"

#### MOC-Schreiben
- [ ] MOC-Datei wird korrekt geschrieben
- [ ] Frontmatter enthält alle Felder
- [ ] Overview-Tabelle enthält Sources
- [ ] Überschreiben mit Warnung

#### Visualisierung
- [ ] ASCII-Visualisierung enthält alle Cluster
- [ ] Zentrale Konzepte sind markiert (★)
- [ ] Große Cluster werden gekürzt

#### Inkrementelles Update
- [ ] Neues Konzept wird korrekt zugewiesen
- [ ] Weit entferntes Konzept wird als unclustered markiert

### Testdaten

- Mock-Embeddings: Zufallsvektoren mit bekannter Struktur (für deterministische Tests)
- Mock-LLM-Antworten für Labels

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/moc-generator.ts` | **Neu** |
| `src/cli.ts` | Ändern (generate-mocs Befehl) |
| `src/pipeline.ts` | Ändern (autoUpdateMocs nach Ingestion) |
| `src/config.ts` | Ändern (autoUpdateMocs Option) |
| `src/index.ts` | Ändern (neue Exports) |
| `tests/moc-generator.test.ts` | **Neu** |
