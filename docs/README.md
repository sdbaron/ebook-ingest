# Roadmap-Übersicht: ebook-ingest

> Abgeleitet aus der ChatGPT-Konversation: Personal Knowledge Engine für Obsidian Vaults.

---

## Status: Ist-Zustand

| Komponente | Status |
|---|---|
| EPUB-Extraktion | ✅ Fertig |
| LLM-Analyse (Ollama) | ✅ Fertig |
| Concept Registry | ✅ Fertig |
| Obsidian Writer | ✅ Fertig |
| Pipeline | ✅ Fertig |
| CLI (mit --resume, --config) | ✅ Fertig |
| PDF-Extraktion | ❌ Fehlt |
| HTML/URL-Extraktion | ❌ Fehlt |
| Source-Modell | ❌ Fehlt |
| Concept Merging | ❌ Fehlt |
| Preprocessing | ❌ Fehlt |
| Vektorsuche | ❌ Fehlt |
| Chat-Interface | ❌ Fehlt |
| Auto MOCs | ❌ Fehlt |

---

## Prioritäten und Abhängigkeiten

```mermaid
graph TD
    P0A[P0: Universal Extractor] --> P0B[P0: Source-Modell]
    P0A --> P1B[P1: Preprocessing]
    P0B --> P1A[P1: Concept Merge]
    P1A --> P2A[P2: Vektorsuche]
    P1B --> P2A
    P2A --> P2B[P2: Chat-Interface]
    P2A --> P3[P3: Auto MOC Clustering]
```

---

## Zeitplan

| Priorität | Feature | Geschätzt | Abhängigkeiten |
|---|---|---|---|
| 🔴 **P0** | Universal Extractor | ~7 h | Keine |
| 🔴 **P0** | Source-Modell | ~5,5 h | Universal Extractor |
| 🟡 **P1** | Concept Merge Engine | ~9 h | Source-Modell |
| 🟡 **P1** | Preprocessing Layer | ~8,5 h | Universal Extractor |
| 🟢 **P2** | Vektorsuche + Embeddings | ~9 h | Preprocessing + Source-Modell |
| 🟢 **P2** | Chat-Interface | ~9,5 h | Vektorsuche |
| 🔵 **P3** | Auto MOC Clustering | ~8 h | Vektorsuche |

**Gesamtaufwand: ~56,5 Stunden**

---

## Empfohlene Reihenfolge

1. **P0 – Universal Extractor** (Grundlage für alle weiteren Formate)
2. **P0 – Source-Modell** (architektonische Basis für v3)
3. **P1 – Preprocessing Layer** (bessere Datenqualität für LLM)
4. **P1 – Concept Merge Engine** (vermeidet Duplikate)
5. **P2 – Vektorsuche + Embeddings** (macht Vault durchsuchbar)
6. **P2 – Chat-Interface** ("Ask my Vault")
7. **P3 – Auto MOC Clustering** (Komfort-Feature)

---

## Dokumente

| Dokument | Inhalt |
|---|---|
| [P0-universal-extractor.md](./P0-universal-extractor.md) | PDF + HTML + URL Extraction, UniversalExtractor-Factory |
| [P0-source-model.md](./P0-source-model.md) | Book → Source Migration, 05_sources/, Registry-Update |
| [P1-concept-merge-engine.md](./P1-concept-merge-engine.md) | Synonym-Erkennung, LLM-basiertes Merging, Redirect-Dateien |
| [P1-preprocessing-layer.md](./P1-preprocessing-layer.md) | PDF-Header/Footer, HTML-Boilerplate, Kapitelerkennung |
| [P2-vector-search.md](./P2-vector-search.md) | ChromaDB-Integration, Embedding-Generator, Semantische Suche |
| [P2-chat-interface.md](./P2-chat-interface.md) | RAG-Pipeline, Chat-Session, Prompt-Templates, Streaming |
| [P3-auto-moc-clustering.md](./P3-auto-moc-clustering.md) | K-Means-Clustering, LLM-Labels, MOC-Generierung |

---

## Architektur-Zielbild (nach allen Tasks)

```
ebook-ingest/
├── src/
│   ├── cli.ts                    # CLI (alle Befehle)
│   ├── config.ts                 # Zentrale Konfiguration
│   ├── index.ts                  # Public API
│   │
│   ├── epub-extractor.ts         # EPUB → Text
│   ├── pdf-extractor.ts          # PDF → Text         (P0)
│   ├── html-extractor.ts         # HTML/URL → Text    (P0)
│   ├── universal-extractor.ts    # Factory             (P0)
│   ├── text-preprocessor.ts      # Cleaning            (P1)
│   │
│   ├── llm-analyzer.ts           # Ollama Analyse
│   ├── embedding-generator.ts    # Ollama Embeddings   (P2)
│   ├── prompt-templates.ts       # Chat Prompt Styles  (P2)
│   │
│   ├── concept-normalizer.ts     # Name → Filename
│   ├── concept-merge-engine.ts   # Duplikat-Merging    (P1)
│   ├── registry-manager.ts       # JSON-Registries
│   ├── knowledge-store.ts        # Source + Concept Store
│   │
│   ├── obsidian-writer.ts        # Markdown schreiben
│   ├── vector-store.ts           # ChromaDB Client     (P2)
│   ├── knowledge-search.ts       # Semantische Suche   (P2)
│   ├── chat-engine.ts            # RAG Chat            (P2)
│   ├── moc-generator.ts          # Auto MOCs           (P3)
│   │
│   ├── pipeline.ts               # Haupt-Pipeline
│   └── migrate-vault.ts          # v2→v3 Migration     (P0)
│
└── tests/
    ├── epub-extractor.test.ts
    ├── pdf-extractor.test.ts     (P0)
    ├── html-extractor.test.ts    (P0)
    ├── universal-extractor.test.ts (P0)
    ├── text-preprocessor.test.ts (P1)
    ├── concept-merge-engine.test.ts (P1)
    ├── embedding-generator.test.ts (P2)
    ├── vector-store.test.ts      (P2)
    ├── chat-engine.test.ts       (P2)
    ├── moc-generator.test.ts     (P3)
    └── fixtures/
```

---

## Wichtige Architektur-Prinzipien

1. **Nicht neue Pipelines — nur neue Extractors.** LLM, Writer, Registry bleiben gleich.
2. **Abwärtskompatibilität.** Alte Methoden werden als deprecated-Wrapper behalten.
3. **Graceful Degradation.** Wenn ChromaDB oder Ollama nicht verfügbar sind, crasht nichts.
4. **TypeScript-first.** Alle Interfaces vor der Implementierung definieren.
5. **Tests für jede neue Datei.** Kein Code ohne Test.
