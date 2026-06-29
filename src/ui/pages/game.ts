import { html } from 'lit-html';
import { footerView } from '../components/footer';
import { playersTableView } from '../components/players-table';
import { voteCardsView, reactionsView } from '../components/vote-cards';
import { statsView } from '../components/stats';
import type { StoreSnapshot } from '../../game/store';
import type { VotingSummary } from '../../app/types';
import type { VoteValue, Reaction } from '../../constants';

/**
 * Game page: 3-column layout.
 *   Left   = players table
 *   Center = voting stats + Clear/Show buttons
 *   Right  = vote cards + reactions
 *
 * Pure function of the store snapshot + a summary + a small set of callbacks.
 * All state flows down; all events delegate up.
 */
export function gamePageView(
  snap: StoreSnapshot,
  summary: VotingSummary | null,
  callbacks: {
    onVote: (vote: VoteValue) => void;
    onReaction: (reaction: Reaction) => void;
    onClearVotes: () => void;
    onShowVotes: () => void;
    onOpenSettings: () => void;
    onNavigateAbout: () => void;
  },
): unknown {
  return html`
    <div class="game-page">
      <header class="game-header">
        <div class="session-info">
          <h2>⚡ RapidPlanning ⚡</h2>
          ${snap.sessionId
            ? html`<div class="session-id">Session: ${snap.sessionId}</div>`
            : null}
        </div>
        <button class="settings-btn" id="header-settings-btn" @click=${callbacks.onOpenSettings}>
          <span class="settings-icon" aria-hidden="true">⚙</span>
          <span>Settings</span>
        </button>
      </header>

      <main class="game-content">
        <div class="players-column">
          <section class="players-section">
            <h3>Players</h3>
            <div id="players-table" class="players-table">
              ${playersTableView(snap.players, snap.votesRevealed)}
            </div>
          </section>
        </div>

        <div class="stats-column">
          <section class="voting-stats-section">
            <h3>Voting Statistics</h3>
            ${statsView(summary, callbacks.onClearVotes, callbacks.onShowVotes)}
          </section>
        </div>

        <div class="controls-column">
          <section class="voting-cards-section">
            <h3>Cast Your Vote</h3>
            <div id="voting-cards">
              ${voteCardsView(snap.selectedVote, callbacks.onVote)}
            </div>
          </section>
          <section class="reactions-section">
            <h3>Reactions</h3>
            <div id="reaction-buttons">
              ${reactionsView(snap.selectedReaction, callbacks.onReaction)}
            </div>
          </section>
        </div>
      </main>

      ${footerView(true)}
    </div>
  `;
}
