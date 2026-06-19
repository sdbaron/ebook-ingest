import ollama from 'ollama';

/**
 * Structure returned by the LLM for a chapter analysis.
 */
export interface ChapterAnalysis {
  title: string;
  summary: string;
  concepts: ConceptEntry[];
}

export interface ConceptEntry {
  name: string;
  description: string;
}

/**
 * Call Ollama for chapter analysis with retry logic.
 */
export class LLMAnalyzer {
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  /**
   * Extract a JSON object from text that may contain markdown fences.
   */
  static extractJson(text: string): string {
    // Strip markdown code fences if present
    let cleaned = text.replace(/```(?:json)?\s*\n?/g, '');
    cleaned = cleaned.replace(/```\s*/g, '');

    // Find the first '{' and match balanced braces
    const start = cleaned.indexOf('{');
    if (start === -1) {
      throw new Error('No JSON returned by model');
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
      } else if (ch === '\\' && inString) {
        escapeNext = true;
      } else if (!inString) {
        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            return cleaned.slice(start, i + 1);
          }
        }
      }
    }

    throw new Error('Unbalanced JSON braces in model response');
  }

  /**
   * Analyze a chapter text using Ollama.
   * Returns structured analysis with title, summary, and concepts.
   */
  async analyze(text: string): Promise<ChapterAnalysis> {
    let prompt = this.buildPrompt(text, false);
    let useFormatJson = true;
    const maxRetries = 2;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.callOllama(prompt, useFormatJson);
        const content = response.message.content;

        // Try to parse the JSON response
        let data: ChapterAnalysis;

        try {
          const jsonStr = LLMAnalyzer.extractJson(content);
          data = JSON.parse(jsonStr);
        } catch (parseErr) {
          if (attempt < maxRetries - 1) {
            console.warn(
              `[WARN] Attempt ${attempt + 1}: JSON parsing failed (${parseErr instanceof Error ? parseErr.message : String(parseErr)}). Retrying with stricter prompt...`,
            );
            useFormatJson = false;
            prompt = this.buildPrompt(text, true);
            continue;
          }
          console.error(`[ERROR] JSON parsing failed after ${maxRetries} attempts.`);
          console.error(`[DEBUG] LLM raw response:\n${content.slice(0, 2000)}`);
          return this.fallbackResult(
            `LLM analysis failed - could not parse JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          );
        }

        // Validate required keys
        if (!data.concepts) {
          console.warn(
            `[WARN] 'concepts' key missing from LLM response. Got keys: ${Object.keys(data).join(', ')}`,
          );
          data.concepts = [];
        }
        if (!data.title) data.title = 'Untitled';
        if (!data.summary) data.summary = '';

        return data;
      } catch (callErr) {
        if (attempt < maxRetries - 1) {
          console.warn(
            `[WARN] Attempt ${attempt + 1}: LLM call failed (${callErr instanceof Error ? callErr.message : String(callErr)}). Retrying...`,
          );
          useFormatJson = false;
          prompt = this.buildPrompt(text, true);
          continue;
        }
        console.error(
          `[ERROR] LLM call failed after ${maxRetries} attempts: ${callErr instanceof Error ? callErr.message : String(callErr)}`,
        );
        return this.fallbackResult(
          `LLM call failed: ${callErr instanceof Error ? callErr.message : String(callErr)}`,
        );
      }
    }

    return this.fallbackResult('LLM analysis failed');
  }

  /**
   * Build the prompt for the LLM.
   */
  private buildPrompt(text: string, strict: boolean): string {
    const truncated = text.slice(0, 12000);

    if (!strict) {
      return `Analyze this technical book chapter.

Return ONLY a valid JSON object with exactly this structure:

{
  "title": "chapter title",
  "summary": "2-3 sentence summary",
  "concepts": [
    {
      "name": "ConceptName",
      "description": "1-2 sentence explanation"
    }
  ]
}

IMPORTANT: Every concept object MUST contain both "name" and "description" keys.
IMPORTANT: Your entire response must be ONLY the JSON object, no other text, no markdown formatting.

Chapter:

${truncated}`;
    }

    return `CRITICAL: You MUST respond with ONLY a valid JSON object. No markdown, no explanations, no code fences. Just JSON.

Chapter:

${truncated}`;
  }

  /**
   * Call Ollama API.
   */
  private async callOllama(
    prompt: string,
    useFormatJson: boolean,
  ): Promise<{ message: { content: string } }> {
    const options: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    };

    if (useFormatJson) {
      try {
        // @ts-expect-error - format may not be in all ollama client versions
        return await ollama.chat({ ...options, format: 'json' });
      } catch {
        // format parameter not supported, fall back to plain chat
      }
    }

    // @ts-expect-error - ollama.chat type compatibility
    return await ollama.chat(options);
  }

  /**
   * Return a fallback result when LLM analysis fails.
   */
  private fallbackResult(reason: string): ChapterAnalysis {
    return {
      title: 'Untitled',
      summary: reason,
      concepts: [],
    };
  }
}
