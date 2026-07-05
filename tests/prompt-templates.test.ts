import { describe, it, expect } from '@jest/globals';
import { promptTemplates, PromptTemplate } from '../src/prompt-templates.js';

describe('promptTemplates', () => {
  it('has three built-in templates', () => {
    expect(Object.keys(promptTemplates)).toHaveLength(3);
    expect(promptTemplates.default).toBeDefined();
    expect(promptTemplates.academic).toBeDefined();
    expect(promptTemplates.concise).toBeDefined();
  });

  it('default template has all required fields', () => {
    const t = promptTemplates.default;
    expect(t.name).toBeTruthy();
    expect(t.systemPrompt).toBeTruthy();
    expect(typeof t.contextWrapper).toBe('function');
    expect(typeof t.questionWrapper).toBe('function');
  });

  it('contextWrapper wraps sources correctly', () => {
    const t = promptTemplates.default;
    const result = t.contextWrapper('source1\nsource2');
    expect(result).toContain('source1');
    expect(result).toContain('source2');
  });

  it('questionWrapper wraps question correctly', () => {
    const t = promptTemplates.default;
    const result = t.questionWrapper('What is X?');
    expect(result).toContain('What is X?');
  });

  it('academic template uses different wording', () => {
    const t = promptTemplates.academic;
    const result = t.contextWrapper('test');
    expect(result).toContain('FORSCHUNGSMATERIAL');
    expect(t.systemPrompt).toContain('Zusammenfassung');
  });

  it('concise template is indeed concise', () => {
    const t = promptTemplates.concise;
    expect(t.systemPrompt).toContain('prägnant');
    expect(t.systemPrompt).toContain('Bullet');
  });
});
