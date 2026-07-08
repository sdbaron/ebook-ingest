import { describe, it, expect } from '@jest/globals';
import { FrontmatterValidator } from '../src/frontmatter-validator.js';

describe('FrontmatterValidator', () => {
  const validFm: Record<string, unknown> = {
    title: 'Test Note',
    type: 'concept',
    domain: 'test-domain',
    owner: 'test-owner',
    created: '2026-01-01',
    updated: '2026-01-01',
    updated_at: '2026-01-01',
    tags: ['test'],
    aliases: [],
  };

  it('passes valid frontmatter', () => {
    const result = FrontmatterValidator.validate(validFm);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails on missing title', () => {
    const result = FrontmatterValidator.validate({
      ...validFm,
      title: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('title'))).toBe(true);
  });

  it('fails on invalid type', () => {
    const result = FrontmatterValidator.validate({
      ...validFm,
      type: 'invalid-type',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('type'))).toBe(true);
  });

  it('fails on missing domain', () => {
    const result = FrontmatterValidator.validate({
      ...validFm,
      domain: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('domain'))).toBe(true);
  });

  it('fails on invalid date format', () => {
    const result = FrontmatterValidator.validate({
      ...validFm,
      created: '2026/01/01',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('created'))).toBe(true);
  });

  it('fails when updated != updated_at', () => {
    const result = FrontmatterValidator.validate({
      ...validFm,
      updated: '2026-01-02',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('updated'))).toBe(true);
  });

  it('fails on empty tags', () => {
    const result = FrontmatterValidator.validate({
      ...validFm,
      tags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('tags'))).toBe(true);
  });

  it('fails on missing aliases array', () => {
    const result = FrontmatterValidator.validate({
      ...validFm,
      aliases: undefined,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('aliases'))).toBe(true);
  });
});
