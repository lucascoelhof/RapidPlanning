import { describe, it, expect } from 'vitest';
import { escapeHtml, initials, generateSessionId } from '../../src/utils/dom';
import { SESSION_ID_PATTERN } from '../../src/constants';

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("a'b&c")).toBe("a&#39;b&amp;c");
  });

  it('handles null / undefined / numbers', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it('neutralises the legacy XSS payload (tag is broken, not executed)', () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(malicious);
    // Escaping `<`/`>` breaks the tag so the browser treats it as text;
    // the `onerror` substring may still appear as inert text — that's fine.
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
  });
});

describe('initials', () => {
  it('takes the first letter of each word, uppercased, capped at 2', () => {
    expect(initials('John Doe')).toBe('JD');
    expect(initials('Ada Lovelace Vance')).toBe('AL');
  });

  it('handles single-word names', () => {
    expect(initials('Prince')).toBe('P');
  });

  it('returns "?" for empty / whitespace input', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
    expect(initials(null as unknown as string)).toBe('?');
  });
});

describe('generateSessionId', () => {
  it('produces a valid 9-digit id', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateSessionId();
      expect(SESSION_ID_PATTERN.test(id)).toBe(true);
    }
  });

  it('stays in the [100000000, 999999999] range', () => {
    for (let i = 0; i < 50; i++) {
      const n = Number(generateSessionId());
      expect(n).toBeGreaterThanOrEqual(100_000_000);
      expect(n).toBeLessThanOrEqual(999_999_999);
    }
  });
});
