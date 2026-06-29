import type { VoteValue } from '../constants';

/**
 * Pure voting helpers. No DOM, no side effects — fully unit-testable.
 */

/** Parse a vote value into a number, returning `null` for non-numeric ('?'). */
export function voteToNumber(vote: string): number | null {
  if (vote === '?') return null;
  if (vote === '½') return 0.5;
  if (vote.trim() === '') return null; // Number('') === 0 — guard explicitly
  const n = Number(vote);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute the numeric average of a list of votes, ignoring non-numeric ones.
 * Returns `null` if there are no numeric votes. Result is rounded to 1 dp.
 *
 * `½` counts as 0.5; `?` is excluded entirely (matches legacy behaviour).
 */
export function averageVote(votes: readonly string[]): string | null {
  const nums = votes.map(voteToNumber).filter((n): n is number => n !== null);
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, n) => acc + n, 0);
  return (sum / nums.length).toFixed(1);
}

/** Count occurrences of each vote value. Returns a plain object map. */
export function tallyVotes(votes: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of votes) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}

/**
 * Sort distinct vote values numerically (ascending), with `?` last.
 * Stable across browsers — does not rely on localeCompare quirks.
 */
export function sortVoteValues(values: readonly string[]): string[] {
  return [...values].sort((a, b) => {
    const na = voteToNumber(a);
    const nb = voteToNumber(b);
    if (na === null && nb === null) return a.localeCompare(b);
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  });
}

/** Resolve a keyboard-typed buffer to the closest vote card. */
export function resolveKeyboardBuffer(buffer: string, options: readonly VoteValue[]): VoteValue | null {
  if (!buffer) return null;
  // Exact match wins outright.
  const exact = options.find((o) => o === buffer);
  if (exact) return exact;
  // Otherwise, for numeric input, snap to the nearest numeric option.
  if (!/^[0-9]+$/.test(buffer)) return null;
  const typed = Number(buffer);
  const numeric = options
    .map((o) => voteToNumber(o))
    .filter((n): n is number => n !== null && Number.isInteger(n))
    .sort((a, b) => a - b);
  if (numeric.length === 0) return null;
  let best = numeric[0]!;
  let bestDist = Math.abs(best - typed);
  for (const opt of numeric) {
    const d = Math.abs(opt - typed);
    if (d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }
  return String(best) as VoteValue;
}
