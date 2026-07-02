import { html } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { escapeHtml, initials } from '../../utils/dom';
import type { Player } from '../../app/types';

/**
 * Players table. Renders a row per player with avatar (or initials fallback),
 * reaction badge, name, and a vote cell that shows `✓` while hidden and the
 * actual value once revealed.
 *
 * All peer-supplied strings go through `escapeHtml`. With lit-html, text
 * interpolations are auto-escaped, but we use the same helper for the avatar
 * `onerror` fallback string and as a defensive measure.
 */

function playerRow(player: Player, votesRevealed: boolean) {
  const avatarInner = player.avatar
    ? html`<img
          src="${player.avatar}"
          alt=""
          @error=${(e: Event) => {
            const img = e.target as HTMLImageElement;
            img.style.display = 'none';
            const sib = img.nextElementSibling as HTMLElement | null;
            if (sib) sib.style.display = 'flex';
          }}
        />
        <span style="display: none">${escapeHtml(initials(player.name))}</span>`
    : html`<span>${escapeHtml(initials(player.name))}</span>`;

  return html`
    <tr
      class="player-row ${player.vote ? 'voted' : ''} ${votesRevealed && player.vote
        ? 'revealed'
        : ''} ${player.isLocal ? 'local' : ''}"
    >
      <td class="player-info">
        <div class="player-avatar">
          ${avatarInner}
          ${player.reaction ? html`<div class="player-reaction">${player.reaction}</div>` : null}
        </div>
        <div class="player-name">${player.name}</div>
      </td>
      <td class="player-vote-cell">
        ${votesRevealed && player.vote
          ? html`<span class="player-vote-value">${player.vote}</span>`
          : player.vote
            ? html`<span class="player-voted-indicator" aria-label="voted">✓</span>`
            : html`<span class="player-no-vote">-</span>`}
      </td>
    </tr>
  `;
}

export function playersTableView(
  players: readonly Player[],
  votesRevealed: boolean,
): unknown {
  return html`
    <table class="players-data-table">
      <tbody>
        ${repeat(
          players,
          (p) => p.id,
          (p) => playerRow(p, votesRevealed),
        )}
      </tbody>
    </table>
  `;
}
