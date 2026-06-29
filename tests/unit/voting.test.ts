import { describe, it, expect } from 'vitest';
import {
  voteToNumber,
  averageVote,
  tallyVotes,
  sortVoteValues,
  resolveKeyboardBuffer,
} from '../../src/game/voting';
import { VOTE_CARDS } from '../../src/constants';

describe('voteToNumber', () => {
  it('parses plain integers', () => {
    expect(voteToNumber('0')).toBe(0);
    expect(voteToNumber('13')).toBe(13);
    expect(voteToNumber('100')).toBe(100);
  });

  it('parses the half glyph as 0.5', () => {
    expect(voteToNumber('½')).toBe(0.5);
  });

  it('returns null for "?"', () => {
    expect(voteToNumber('?')).toBeNull();
  });

  it('returns null for unexpected strings', () => {
    expect(voteToNumber('foo')).toBeNull();
    expect(voteToNumber('')).toBeNull();
  });
});

describe('averageVote', () => {
  it('returns null when there are no numeric votes', () => {
    expect(averageVote(['?'])).toBeNull();
    expect(averageVote([])).toBeNull();
  });

  it('ignores non-numeric votes', () => {
    // (5 + 8) / 2 = 6.5
    expect(averageVote(['5', '8', '?'])).toBe('6.5');
  });

  it('counts the half glyph as 0.5', () => {
    expect(averageVote(['½', '1', '2'])).toBe('1.2'); // (0.5 + 1 + 2) / 3 = 1.166... -> 1.2
  });

  it('matches the legacy "6.0" sample', () => {
    expect(averageVote(['5', '8', '5'])).toBe('6.0');
  });
});

describe('tallyVotes', () => {
  it('counts occurrences', () => {
    expect(tallyVotes(['5', '5', '8'])).toEqual({ '5': 2, '8': 1 });
  });

  it('returns an empty object for no votes', () => {
    expect(tallyVotes([])).toEqual({});
  });
});

describe('sortVoteValues', () => {
  it('sorts numerically ascending', () => {
    expect(sortVoteValues(['13', '5', '0', '100'])).toEqual(['0', '5', '13', '100']);
  });

  it('places "?" last', () => {
    expect(sortVoteValues(['?', '5', '0'])).toEqual(['0', '5', '?']);
  });

  it('places "½" between 0 and 1', () => {
    expect(sortVoteValues(['1', '0', '½'])).toEqual(['0', '½', '1']);
  });
});

describe('resolveKeyboardBuffer', () => {
  it('returns the exact match when present', () => {
    expect(resolveKeyboardBuffer('5', VOTE_CARDS)).toBe('5');
    expect(resolveKeyboardBuffer('½', VOTE_CARDS)).toBe('½');
    expect(resolveKeyboardBuffer('?', VOTE_CARDS)).toBe('?');
  });

  it('snaps to the nearest numeric option for typed numbers', () => {
    // 4 isn't on the deck — nearest of {0,1,2,3,5,8,13,20,40,100} is 3 or 5
    const result = resolveKeyboardBuffer('4', VOTE_CARDS);
    expect(['3', '5']).toContain(result);
  });

  it('returns null for an empty buffer', () => {
    expect(resolveKeyboardBuffer('', VOTE_CARDS)).toBeNull();
  });

  it('returns null for letters', () => {
    expect(resolveKeyboardBuffer('abc', VOTE_CARDS)).toBeNull();
  });

  it('returns null for non-integer fractional input', () => {
    expect(resolveKeyboardBuffer('1.5', VOTE_CARDS)).toBeNull();
  });
});
