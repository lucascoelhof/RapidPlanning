import { html } from 'lit-html';
import type { VotingSummary } from '../../app/types';
import { sortVoteValues } from '../../game/voting';

/**
 * Voting statistics panel — average + breakdown + consensus indicator.
 * Takes a `VotingSummary` (built by the store) and is otherwise stateless.
 */
export function statsView(
  summary: VotingSummary | null,
  onClearVotes: () => void,
  onShowVotes: () => void,
): unknown {
  const hasVotes = (summary?.total ?? 0) > 0;

  return html`
    <div class="stats-actions">
      <button type="button" class="btn btn-secondary btn-small" @click=${onClearVotes}>
        Clear Votes
      </button>
      <button type="button" class="btn btn-secondary btn-small" @click=${onShowVotes}>
        Show Votes
      </button>
    </div>
    <div class="stats-content" style=${hasVotes ? 'display:flex' : 'display:none'}>
      ${summary && summary.consensus
        ? html`
            <div class="consensus-section">
              <div
                class="consensus-message ${summary.consensus.type} ${summary.consensus.highlight
                  ? 'highlight'
                  : ''}"
              >
                ${summary.consensus.message}
              </div>
            </div>
          `
        : null}
      <div class="average-section">
        <strong>Average:</strong>
        <div class="average-value">
          ${summary?.average ?? 'N/A'}
        </div>
      </div>
      <div class="votes-breakdown">
        <div class="breakdown-header">
          <span><strong>Points</strong></span>
          <span><strong>Votes</strong></span>
        </div>
        ${summary
          ? sortVoteValues(Object.keys(summary.votes)).map(
              (value) => html`
                <div class="vote-breakdown-row">
                  <span class="vote-value">${value}</span>
                  <span class="vote-count">${summary.votes[value]}</span>
                </div>
              `,
            )
          : null}
      </div>
    </div>
  `;
}
