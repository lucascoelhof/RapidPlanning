import type { ConsensusResult } from '../app/types';
import { voteToNumber, averageVote, tallyVotes } from './voting';

/**
 * Consensus detection — a direct, type-safe port of the legacy algorithm.
 * Kept as a pure function so it's trivially unit-testable and reused by the
 * store without coupling to the network layer.
 *
 * Categories (unchanged from v1, for behavioural parity):
 *  - insufficient : fewer than 2 votes
 *  - perfect      : every vote identical
 *  - close        : numeric range <= 2 (requires >=80% numeric votes)
 *  - divergent    : numeric range >= 10
 *  - majority     : >60% of votes are the same value
 *  - none         : fallback ("discussion needed")
 */
export function detectConsensus(votes: readonly string[]): ConsensusResult {
  if (votes.length < 2) {
    return { type: 'insufficient', message: 'Need more votes', highlight: false };
  }

  // Perfect consensus: everyone voted the same value.
  const unique = new Set(votes);
  if (unique.size === 1) {
    const value = votes[0]!;
    return { type: 'perfect', message: `Perfect consensus on ${value}!`, highlight: true };
  }

  // Numeric-based heuristics require at least 80% numeric votes.
  const numeric = votes.map(voteToNumber).filter((n): n is number => n !== null);
  if (numeric.length >= votes.length * 0.8) {
    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    const range = max - min;
    if (range === 0) {
      return { type: 'perfect', message: `Perfect consensus on ${min}!`, highlight: true };
    }
    if (range <= 2) {
      return { type: 'close', message: `Close consensus (range: ${range})`, highlight: false };
    }
    if (range >= 10) {
      return { type: 'divergent', message: `Wide range of estimates (${min}-${max})`, highlight: false };
    }
  }

  // Majority: more than 60% of votes share the same value.
  const counts = tallyVotes(votes);
  let maxCount = 0;
  let maxValue: string | null = null;
  for (const [value, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxValue = value;
    }
  }
  // We've already handled perfect (size === 1), so maxValue is guaranteed set.
  if (maxValue !== null && maxCount > votes.length * 0.6) {
    return {
      type: 'majority',
      message: `Majority consensus on ${maxValue} (${maxCount}/${votes.length})`,
      highlight: false,
    };
  }

  return { type: 'none', message: 'No consensus - discussion needed', highlight: false };
}

/** Build the full VotingSummary used to render the stats panel. */
export function buildVotingSummary(votes: readonly string[]): {
  votes: Record<string, number>;
  total: number;
  average: string | null;
  consensus: ConsensusResult;
} {
  return {
    votes: tallyVotes(votes),
    total: votes.length,
    average: averageVote(votes),
    consensus: detectConsensus(votes),
  };
}
