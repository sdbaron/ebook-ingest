import { describe, it, expect } from '@jest/globals';
import { toDateOnly, todayDateOnly } from '../src/date-utils.js';

describe('date-utils', () => {
  describe('toDateOnly', () => {
    it('extracts YYYY-MM-DD from ISO-8601', () => {
      expect(toDateOnly('2026-06-19T10:00:00.000Z')).toBe('2026-06-19');
    });
  });

  describe('todayDateOnly', () => {
    it('returns YYYY-MM-DD format', () => {
      const result = todayDateOnly();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
