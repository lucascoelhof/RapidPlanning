import { describe, it, expect } from 'vitest';
import { detectConsensus, buildVotingSummary } from '../../src/game/consensus';

describe('detectConsensus', () => {
  it('flags insufficient votes (< 2)', () => {
    expect(detectConsensus([]).type).toBe('insufficient');
    expect(detectConsensus(['5']).type).toBe('insufficient');
  });

  it('detects perfect consensus on a number', () => {
    const r = detectConsensus(['5', '5', '5']);
    expect(r.type).toBe('perfect');
    expect(r.message).toBe('Perfect consensus on 5!');
    expect(r.highlight).toBe(true);
  });

  it('detects perfect consensus on "?"', () => {
    const r = detectConsensus(['?', '?']);
    expect(r.type).toBe('perfect');
    expect(r.message).toBe('Perfect consensus on ?!');
  });

  it('detects close consensus (range <= 2)', () => {
    const r = detectConsensus(['3', '5', '3']);
    expect(r.type).toBe('close');
    expect(r.message).toBe('Close consensus (range: 2)');
    expect(r.highlight).toBe(false);
  });

  it('detects divergent consensus (range >= 10)', () => {
    const r = detectConsensus(['1', '20', '5']);
    expect(r.type).toBe('divergent');
    expect(r.message).toBe('Wide range of estimates (1-20)');
  });

  it('detects majority consensus (>60% same)', () => {
    const r = detectConsensus(['5', '5', '5', '8']); // 3/4 = 75%
    expect(r.type).toBe('majority');
    expect(r.message).toBe('Majority consensus on 5 (3/4)');
  });

  it('does NOT flag majority at exactly 60% (boundary)', () => {
    // 3/5 = 60%, must be strictly >60%
    const r = detectConsensus(['5', '5', '5', '8', '3']);
    expect(r.type).not.toBe('majority');
  });

  it('handles half-point votes in close consensus', () => {
    // ½ (0.5), 1, 2 → range 1.5
    const r = detectConsensus(['½', '1', '2']);
    expect(r.type).toBe('close');
    expect(r.message).toBe('Close consensus (range: 1.5)');
  });

  it('falls back to "none" for spread votes', () => {
    const r = detectConsensus(['1', '5', '13', '?']);
    expect(r.type).toBe('none');
    expect(r.message).toBe('No consensus - discussion needed');
  });

  it('detects majority on mixed numeric + "?"', () => {
    const r = detectConsensus(['?', '?', '?', '5']); // 3/4 = 75%
    expect(r.type).toBe('majority');
    expect(r.message).toBe('Majority consensus on ? (3/4)');
  });
});

describe('buildVotingSummary', () => {
  it('aggregates votes, average and consensus', () => {
    const s = buildVotingSummary(['5', '8', '5']);
    expect(s.total).toBe(3);
    expect(s.votes).toEqual({ '5': 2, '8': 1 });
    expect(s.average).toBe('6.0');
    expect(s.consensus.type).toBe('majority');
  });

  it('reports insufficient consensus on empty input', () => {
    const s = buildVotingSummary([]);
    expect(s.total).toBe(0);
    expect(s.average).toBeNull();
    expect(s.consensus.type).toBe('insufficient');
  });
});
