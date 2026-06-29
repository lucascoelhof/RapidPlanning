import { html, render } from 'lit-html';
import { escapeHtml } from '../../utils/dom';

/**
 * Transient toast + blocking modal helpers. These replace the inline-styled
 * `showConnecting` / `showConnectionError` / `showGameError` methods that were
 * scattered through the legacy UIManager. Using CSS classes (not `style.cssText`)
 * means they respect the theme.
 */

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Show a transient toast. Auto-dismisses after `durationMs`. */
export function showToast(
  message: string,
  kind: 'success' | 'warning' | 'error' | 'info' = 'info',
  durationMs = 4_000,
): void {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  render(
    html`<div class="toast toast-${kind}" role="status">${escapeHtml(message)}</div>`,
    host,
  );
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (host) render(html``, host);
  }, durationMs);
}

/** Top-center "connecting" spinner. Call `hideConnecting()` to remove. */
export function showConnecting(message: string): void {
  let host = document.getElementById('connecting-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'connecting-host';
    document.body.appendChild(host);
  }
  render(
    html`<div class="connecting-indicator" role="alert" aria-live="assertive">
      <svg class="connecting-spinner" viewBox="0 0 50 50" aria-hidden="true">
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="currentColor"
          stroke-width="5"
          stroke-dasharray="31.4 31.4"
          transform="rotate(-90 25 25)"
        />
      </svg>
      <span>${escapeHtml(message)}</span>
    </div>`,
    host,
  );
}

export function hideConnecting(): void {
  const host = document.getElementById('connecting-host');
  if (host) render(html``, host);
}

export interface ConnectionErrorView {
  title: string;
  message: string;
  onRetry: () => void;
  onJoinNew: () => void;
  onGoHome: () => void;
}

/** Blocking connection-error modal with three recovery actions. */
export function showConnectionError(opts: ConnectionErrorView): void {
  let host = document.getElementById('conn-error-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'conn-error-host';
    document.body.appendChild(host);
  }
  const dismiss = () => render(html``, host!);
  render(
    html`
      <div class="connection-error-backdrop" role="dialog" aria-modal="true">
        <div class="connection-error-card">
          <div class="connection-error-icon" aria-hidden="true">⚠️</div>
          <h2 class="connection-error-title">${escapeHtml(opts.title)}</h2>
          <p class="connection-error-message">${escapeHtml(opts.message)}</p>
          <div class="connection-error-actions">
            <button
              class="btn btn-primary"
              @click=${() => {
                dismiss();
                opts.onRetry();
              }}
            >
              🔄 Retry Connection
            </button>
            <button
              class="btn btn-secondary"
              @click=${() => {
                dismiss();
                opts.onJoinNew();
              }}
            >
              ✏️ Join as New User
            </button>
            <button
              class="btn btn-ghost"
              @click=${() => {
                dismiss();
                opts.onGoHome();
              }}
            >
              🏠 Go Home
            </button>
          </div>
        </div>
      </div>
    `,
    host,
  );
}

export function hideConnectionError(): void {
  const host = document.getElementById('conn-error-host');
  if (host) render(html``, host);
}

/** Settings dialog (theme switcher + keyboard-shortcuts link). */
export interface SettingsCallbacks {
  currentTheme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
}

export function showSettings(opts: SettingsCallbacks): void {
  let host = document.getElementById('settings-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'settings-host';
    document.body.appendChild(host);
  }
  const close = () => render(html``, host!);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  const showShortcuts = () => {
    close();
    showShortcutsModal();
  };

  render(
    html`
      <div class="settings-backdrop" role="dialog" aria-modal="true" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) close();
      }}>
        <div class="settings-dialog">
          <div class="settings-header">
            <h3>Settings</h3>
            <button class="settings-close-btn" aria-label="Close" @click=${close}>×</button>
          </div>
          <div class="settings-body">
            <div class="settings-section">
              <div class="settings-section-title">Appearance</div>
              <div class="settings-row">
                <span class="settings-row-label">Theme</span>
                <div class="theme-toggle">
                  <button
                    class="theme-option ${opts.currentTheme === 'light' ? 'active' : ''}"
                    @click=${() => opts.onThemeChange('light')}
                  >
                    Light
                  </button>
                  <button
                    class="theme-option ${opts.currentTheme === 'dark' ? 'active' : ''}"
                    @click=${() => opts.onThemeChange('dark')}
                  >
                    Dark
                  </button>
                </div>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-section-title">Help</div>
              <button class="settings-shortcuts-btn" @click=${showShortcuts}>
                <span>Keyboard Shortcuts</span>
                <span class="arrow" aria-hidden="true">›</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `,
    host,
  );
}

export function showShortcutsModal(): void {
  let host = document.getElementById('shortcuts-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'shortcuts-host';
    document.body.appendChild(host);
  }
  const close = () => render(html``, host!);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  const rows: Array<[string, string]> = [
    ['0-9, ½, ?', 'Vote (0.5s delay)'],
    ['+ / =', 'Next vote option'],
    ['- / _', 'Previous vote option'],
    ['Enter', 'Show votes'],
    ['Esc', 'Clear votes'],
  ];
  render(
    html`
      <div class="shortcuts-modal-backdrop" role="dialog" aria-modal="true" @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) close();
      }}>
        <div class="shortcuts-modal">
          <div class="shortcuts-modal-header">
            <h3>Keyboard Shortcuts</h3>
            <button class="shortcuts-modal-close" aria-label="Close" @click=${close}>×</button>
          </div>
          <div class="shortcuts-modal-body">
            <div class="shortcuts-grid">
              ${rows.map(
                ([key, label]) => html`
                  <div class="shortcut-item">
                    <kbd>${key}</kbd>
                    <span>${label}</span>
                  </div>
                `,
              )}
            </div>
          </div>
        </div>
      </div>
    `,
    host,
  );
}
