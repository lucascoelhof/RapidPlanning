import { VOTE_CARDS, TIMING, type VoteValue } from '../constants';
import { resolveKeyboardBuffer } from '../game/voting';

/**
 * Keyboard shortcuts controller (game page only).
 *
 * | Key           | Action                  |
 * |---------------|-------------------------|
 * | 0-9, ½, ?     | Type a vote (0.5s snap) |
 * | + / =         | Next vote option        |
 * | - / _         | Previous vote option    |
 * | Enter         | Show votes              |
 * | Esc           | Clear votes             |
 *
 * Disabled while focused in an input/textarea or when a modal is open.
 *
 * The controller calls back to the provided handlers rather than touching the
 * store directly, so it stays UI-only and testable.
 */
export interface KeyboardHandlers {
  onVote: (vote: VoteValue) => void;
  onShowVotes: () => void;
  onClearVotes: () => void;
  onNavigate: (direction: 1 | -1) => void;
}

export class KeyboardController {
  private buffer = '';
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;
  private handler: ((e: KeyboardEvent) => void) | null = null;
  private active = false;

  constructor(private readonly handlers: KeyboardHandlers) {}

  /** Start listening. Safe to call once per page mount. */
  attach(): void {
    if (this.active) return;
    this.active = true;
    this.handler = (e: KeyboardEvent) => this.handle(e);
    document.addEventListener('keydown', this.handler);
  }

  /** Stop listening and release the listener. Call on page unmount. */
  detach(): void {
    if (!this.active || !this.handler) return;
    document.removeEventListener('keydown', this.handler);
    this.handler = null;
    this.active = false;
    this.resetBuffer();
  }

  private handle(e: KeyboardEvent): void {
    // Ignore while typing in a field.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    // Ignore while a modal is open.
    if (document.querySelector('.settings-backdrop, .shortcuts-modal-backdrop, .error-modal-backdrop')) {
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.handlers.onClearVotes();
        return;
      case 'Enter':
        e.preventDefault();
        this.handlers.onShowVotes();
        return;
      case '+':
      case '=':
        e.preventDefault();
        this.handlers.onNavigate(1);
        return;
      case '-':
      case '_':
        e.preventDefault();
        this.handlers.onNavigate(-1);
        return;
    }

    if (/^[0-9½?]$/.test(e.key)) {
      e.preventDefault();
      this.addToBuffer(e.key);
    }
  }

  private addToBuffer(key: string): void {
    this.buffer += key;
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => this.flushBuffer(), TIMING.keyboardBufferMs);
  }

  private flushBuffer(): void {
    const resolved = resolveKeyboardBuffer(this.buffer, VOTE_CARDS);
    this.resetBuffer();
    if (resolved) this.handlers.onVote(resolved);
  }

  private resetBuffer(): void {
    this.buffer = '';
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }
}
