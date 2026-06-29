import { html } from 'lit-html';
import { VOTE_CARDS, REACTIONS, type VoteValue, type Reaction } from '../../constants';

/**
 * Pure presentational components for vote cards and reactions.
 * Selection state comes in as a prop; clicks delegate up via `onVote`.
 */

export function voteCardsView(
  selectedVote: VoteValue | null,
  onVote: (vote: VoteValue) => void,
): unknown {
  return html`
    <div class="voting-cards" role="group" aria-label="Vote cards">
      ${VOTE_CARDS.map(
        (card) => html`
          <button
            type="button"
            class="vote-card ${selectedVote === card ? 'selected' : ''}"
            data-vote="${card}"
            aria-pressed="${selectedVote === card}"
            @click=${() => onVote(card)}
          >
            ${card}
          </button>
        `,
      )}
    </div>
  `;
}

export function reactionsView(
  selectedReaction: Reaction | null,
  onReaction: (reaction: Reaction) => void,
): unknown {
  return html`
    <div class="reaction-buttons" role="group" aria-label="Reactions">
      ${REACTIONS.map(
        (r) => html`
          <button
            type="button"
            class="reaction-btn ${selectedReaction === r ? 'active' : ''}"
            data-reaction="${r}"
            aria-pressed="${selectedReaction === r}"
            @click=${() => onReaction(r)}
          >
            ${r}
          </button>
        `,
      )}
    </div>
  `;
}
