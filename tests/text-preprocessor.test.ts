import { describe, it, expect } from '@jest/globals';
import { TextPreprocessor, PreprocessorOptions } from '../src/text-preprocessor.js';

// Helper: build a block with at least `length` chars by repeating filler
function block(text: string, minLen: number = 250): string {
  const filler = ' Additional filler text to meet minimum length requirements for preprocessing tests.';
  while (text.length < minLen) {
    text += filler;
  }
  return text;
}

const lenientOptions: PreprocessorOptions = {
  removeHeadersFooters: true,
  minBlockLength: 50,
  maxBlockLength: 15000,
  detectChapters: true,
  removeBoilerplate: true,
};

describe('TextPreprocessor', () => {
  const lenient = new TextPreprocessor(lenientOptions);

  describe('process', () => {
    it('returns stats with original and filtered counts', () => {
      const blocks = [block('This is a valid block with enough text content.')];
      const result = lenient.process(blocks, 'epub');
      expect(result.stats.originalBlockCount).toBe(1);
      expect(result.stats.filteredBlockCount).toBe(1);
    });

    it('filters blocks below minBlockLength', () => {
      const strict = new TextPreprocessor({ ...lenientOptions, minBlockLength: 2000 });
      const blocks = ['Too short'];
      const result = strict.process(blocks, 'epub');
      expect(result.stats.filteredBlockCount).toBe(0);
    });

    it('removes boilerplate copyright text', () => {
      const blocks = [block('This is a valid block. Copyright © 2024 Test Corp. All rights reserved.')];
      const result = lenient.process(blocks, 'html');
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.blocks[0]).not.toMatch(/Copyright/i);
    });

    it('removes page number patterns', () => {
      const blocks = [block('This is a valid block. Page 42 of 100 contains important information.')];
      const result = lenient.process(blocks, 'html');
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.blocks[0]).not.toMatch(/Page 42 of 100/i);
    });

    it('normalizes whitespace', () => {
      const blocks = [block('This   is    a block    with   extra  whitespace.')];
      const result = lenient.process(blocks, 'epub');
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.blocks[0]).not.toContain('   ');
    });

    it('filters non-text blocks (low letter ratio)', () => {
      const blocks = [
        '1234567890 +-*/=<>[]{}() %$#@! 1234567890 +-*/=<>[]{}() %$#@! 1234567890 +-*/=<>[]{}() %$#@! 1234567890',
      ];
      const result = lenient.process(blocks, 'epub');
      expect(result.blocks).toEqual([]);
    });

    it('detects chapter headings in text', () => {
      const blocks = [block(
        'Some introductory text. Chapter 1 The Beginning. More text follows after the chapter heading that continues the narrative with sufficient content.',
        500,
      )];
      const result = lenient.process(blocks, 'pdf');
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('preprocessor options', () => {
    it('respects minBlockLength option', () => {
      const strict = new TextPreprocessor({ ...lenientOptions, minBlockLength: 2000 });
      const blocks = [block('short', 50)];
      const result = strict.process(blocks, 'epub');
      // Block under length gets filtered
      expect(result.stats.filteredBlockCount).toBe(0);
    });

    it('can disable chapter detection', () => {
      const noChapters = new TextPreprocessor({ ...lenientOptions, detectChapters: false });
      const blocks = [block('Chapter 1 Introduction. This is a valid block.')];
      const result = noChapters.process(blocks, 'pdf');
      expect(result.stats.chapterBoundariesDetected).toBe(0);
    });

    it('can disable boilerplate removal', () => {
      const noBoilerplate = new TextPreprocessor({ ...lenientOptions, removeBoilerplate: false });
      const blocks = [block('This is a valid block. Copyright © 2024 Test Corp.')];
      const result = noBoilerplate.process(blocks, 'html');
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.blocks[0]).toMatch(/Copyright/i);
    });
  });
});
