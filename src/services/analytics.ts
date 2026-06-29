import { Emitter } from '../utils/emitter';

/**
 * GoatCounter analytics wrapper. Fixes the legacy bug where `trackEvent`
 * would recursively `setTimeout` itself forever if GoatCounter never loaded.
 *
 * Instead, events fired before GoatCounter is ready are dropped silently
 * (with a debug log). We never queue infinitely.
 *
 * GoatCounter is loaded via a CDN `<script>` tag in `index.html`. If the
 * script is blocked (ad blockers, corporate proxies) we fail open — analytics
 * must never break the app.
 */
interface GoatCounter {
  count(opts: { path: string; title?: string; event?: boolean }): void;
}

interface AnalyticsEvents {
  ready: [];
}

class AnalyticsService extends Emitter<AnalyticsEvents> {
  private goatcounter: GoatCounter | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.startPolling();
  }

  private startPolling(): void {
    if (typeof window === 'undefined') return;
    if ((window as { goatcounter?: GoatCounter }).goatcounter) {
      this.markReady();
      return;
    }
    this.pollHandle = setInterval(() => {
      if ((window as { goatcounter?: GoatCounter }).goatcounter) {
        this.markReady();
      }
    }, 200);
    // Stop polling after 5s — we don't want to keep checking forever.
    setTimeout(() => {
      if (this.pollHandle) {
        clearInterval(this.pollHandle);
        this.pollHandle = null;
      }
    }, 5_000);
  }

  private markReady(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.goatcounter = (window as { goatcounter?: GoatCounter }).goatcounter ?? null;
    this.emit('ready');
  }

  get isEnabled(): boolean {
    return this.goatcounter !== null;
  }

  /** Fire a custom event. Silently dropped if GoatCounter isn't loaded. */
  trackEvent(name: string): void {
    if (!this.goatcounter) {
      // Not ready (or blocked). Fail open — do NOT queue infinitely.
      return;
    }
    try {
      this.goatcounter.count({
        path: `/event/${name}`,
        title: name.replace(/-/g, ' '),
        event: true,
      });
    } catch (err) {
      console.warn('[analytics] failed to track', name, err);
    }
  }

  trackPageView(path?: string): void {
    if (!this.goatcounter) return;
    try {
      this.goatcounter.count({ path: path ?? window.location.pathname });
    } catch (err) {
      console.warn('[analytics] failed to track page view', err);
    }
  }

  // Domain-specific helpers — keep call sites readable.
  trackRoomCreated(): void {
    this.trackEvent('room-created');
  }
  trackUserJoined(isHost: boolean): void {
    this.trackEvent(isHost ? 'host-joined' : 'participant-joined');
  }
  trackVotingStarted(): void {
    this.trackEvent('voting-round-started');
  }
  trackVoteSubmitted(): void {
    this.trackEvent('vote-submitted');
  }
  trackVotesRevealed(): void {
    this.trackEvent('votes-revealed');
  }
  trackRoomLeft(): void {
    this.trackEvent('room-left');
  }
}

export const analytics = new AnalyticsService();
