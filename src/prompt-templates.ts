/**
 * Configurable prompt templates for different answer styles.
 */
export interface PromptTemplate {
  name: string;
  description: string;
  systemPrompt: string;
  contextWrapper: (sources: string) => string;
  questionWrapper: (question: string) => string;
}

/**
 * Standard factual answer style.
 */
const defaultTemplate: PromptTemplate = {
  name: 'Standard (faktisch)',
  description: 'Präzise Antworten mit Quellenangaben',
  systemPrompt: `Du bist ein Wissens-Assistent mit Zugriff auf eine persönliche Wissensdatenbank.
Beantworte die Frage des Benutzers NUR auf Basis der folgenden Quellen.
Wenn die Quellen die Frage nicht beantworten können, sage ehrlich "Das kann ich aus meinen Quellen nicht beantworten."
Zitiere die Quellen-Nummern in deiner Antwort, z.B. [1], [2].`,
  contextWrapper: (sources) => `=== QUELLEN ===\n${sources}`,
  questionWrapper: (q) => `=== FRAGE ===\n${q}\n\n=== ANTWORT (mit Quellenangaben [1], [2], ...) ===`,
};

/**
 * Academic style with structured output.
 */
const academicTemplate: PromptTemplate = {
  name: 'Akademisch (ausführlich)',
  description: 'Strukturierte Antworten mit Zusammenfassung, Details, Quellen',
  systemPrompt: `Du bist ein akademischer Forschungs-Assistent.
Beantworte Fragen ausführlich, mit präzisen Quellenangaben.
Strukturiere deine Antwort in drei Abschnitte:
1. Zusammenfassung (2-3 Sätze)
2. Details (ausführliche Erklärung)
3. Quellen (Liste der verwendeten Quellen)

Wenn die Quellen nicht ausreichen, sage es ehrlich.`,
  contextWrapper: (sources) => `=== FORSCHUNGSMATERIAL ===\n${sources}`,
  questionWrapper: (q) => `=== FORSCHUNGSFRAGE ===\n${q}\n\n=== AUSFÜHRLICHE ANTWORT ===`,
};

/**
 * Concise bullet-point style.
 */
const conciseTemplate: PromptTemplate = {
  name: 'Kurz (Bullet Points)',
  description: 'Knappe Antworten in 3-5 Stichpunkten',
  systemPrompt: `Du bist ein prägnanter Wissens-Assistent.
Antworte in 3-5 Bullet Points. Zitiere mit [1], [2].
Fasse dich kurz und komm direkt zum Punkt.`,
  contextWrapper: (sources) => `Quellen:\n${sources}`,
  questionWrapper: (q) => `Frage: ${q}\n\nAntwort (Bullet Points):`,
};

/**
 * All available prompt templates.
 */
export const promptTemplates: Record<string, PromptTemplate> = {
  default: defaultTemplate,
  academic: academicTemplate,
  concise: conciseTemplate,
};
