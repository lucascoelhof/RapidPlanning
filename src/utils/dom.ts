/**
 * DOM helpers. Two responsibilities:
 *
 *  1. `escapeHtml` — every string that came from the network MUST go through
 *     this before being interpolated into lit-html (lit-html auto-escapes text
 *     interpolations, but we keep this for any `innerHTML`/template cases and
 *     as a defensive belt-and-braces measure). The legacy app had an XSS hole
 *     where a malicious peer's `name` could execute JS in other clients.
 *
 *  2. `initials(name)` — derive the avatar fallback from a display name.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_REGEX = /[&<>"']/g;

/** Escape a string for safe insertion into HTML text content. */
export function escapeHtml(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return str.replace(ESCAPE_REGEX, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Derive up to 2 initials from a display name. Handles unicode whitespace.
 * Empty / whitespace-only input returns '?'.
 */
export function initials(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  const letters = words.map((w) => Array.from(w)[0] ?? '').join('');
  return (letters.toUpperCase() || '?').slice(0, 2);
}

/** Query an element or throw a helpful error if it's missing. */
export function querySelectorOrThrow<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Required element "${selector}" not found`);
  return el;
}

/** Promise that resolves after `ms`. Small convenience for retry/backoff. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random 9-digit session id in [100000000, 999999999].
 * Uses `crypto.getRandomValues` when available for uniform distribution.
 */
export function generateSessionId(): string {
  const min = 100_000_000;
  const max = 999_999_999;
  const range = max - min;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const n = buf[0] ?? Math.floor(Math.random() * (range + 1));
    return String(min + (n % (range + 1)));
  }
  return String(min + Math.floor(Math.random() * (range + 1)));
}
