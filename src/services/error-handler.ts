import { STORAGE_KEYS } from '../constants';
import type { NoticeKind } from '../app/types';

/**
 * Global error boundary. Wraps risky operations, categorises thrown values
 * into user-friendly notices, and surfaces them via a callback (the UI layer
 * subscribes to `onNotice`).
 *
 * Replaces the legacy `ErrorHandler`. Notable improvements:
 *   - Errors are pushed to an in-memory ring buffer + localStorage, but the
 *     localStorage write is try/caught (legacy crashed if quota was full).
 *   - Categorisation is data-driven (a table of predicates) instead of a
 *     long if/else chain.
 *   - `safeAsync` / `safeSync` return typed results instead of `null`.
 */

export interface ErrorNotice {
  kind: NoticeKind;
  title: string;
  message: string;
  action: 'retry' | 'refresh' | 'clear_data' | 'none';
}

export interface ErrorContext {
  type?: 'javascript' | 'promise' | 'async' | 'sync' | 'network';
  filename?: string;
  [key: string]: unknown;
}

interface LoggedError {
  message: string;
  stack?: string;
  timestamp: string;
  context: ErrorContext;
  url: string;
}

interface CategorisationRule {
  match: (message: string, ctx: ErrorContext) => boolean;
  notice: Omit<ErrorNotice, 'message'> & { message: (detail: string) => string };
}

const RULES: CategorisationRule[] = [
  {
    match: (m) => /fetch|network|connection/.test(m),
    notice: {
      kind: 'warning',
      title: 'Connection Issue',
      action: 'retry',
      message: () =>
        'Having trouble connecting. Please check your internet connection and try again.',
    },
  },
  {
    match: (m) => /peer|webrtc|datachannel/.test(m),
    notice: {
      kind: 'warning',
      title: 'Connection Problem',
      action: 'refresh',
      message: () =>
        'Unable to connect to other players. This might be due to firewall or network restrictions.',
    },
  },
  {
    match: (m) => /localstorage|quota/.test(m),
    notice: {
      kind: 'warning',
      title: 'Storage Full',
      action: 'clear_data',
      message: () => 'Your browser storage is full. Some features may not work properly.',
    },
  },
  {
    match: (m) => /permission|denied/.test(m),
    notice: {
      kind: 'warning',
      title: 'Permission Required',
      action: 'none',
      message: () => 'This feature requires browser permissions. Please check your settings.',
    },
  },
];

const MAX_LOG_SIZE = 50;
const PERSISTED_LOG_SIZE = 10;

export class ErrorHandler {
  private log: LoggedError[] = [];
  private noticeHandler: ((notice: ErrorNotice) => void) | null = null;
  /** Bound global listeners, stored so `destroy()` can remove them. */
  private readonly handleError = (e: ErrorEvent): void => {
    this.handle(e.error ?? new Error(e.message), {
      type: 'javascript',
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  };
  private readonly handleRejection = (e: PromiseRejectionEvent): void => {
    this.handle(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), {
      type: 'promise',
    });
    e.preventDefault();
  };

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', this.handleError);
    window.addEventListener('unhandledrejection', this.handleRejection);
  }

  /** Remove global listeners. Symmetric with the other services' `destroy()`. */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('error', this.handleError);
      window.removeEventListener('unhandledrejection', this.handleRejection);
    }
    this.noticeHandler = null;
  }

  /** Subscribe to user-facing error notices. Returns an unsubscribe. */
  onNotice(fn: (notice: ErrorNotice) => void): () => void {
    this.noticeHandler = fn;
    return () => {
      if (this.noticeHandler === fn) this.noticeHandler = null;
    };
  }

  handle(error: Error, context: ErrorContext = {}): void {
    const entry: LoggedError = {
      message: error?.message ?? 'Unknown error',
      stack: error?.stack,
      timestamp: new Date().toISOString(),
      context,
      url: typeof window !== 'undefined' ? window.location.href : '',
    };
    this.log.unshift(entry);
    if (this.log.length > MAX_LOG_SIZE) this.log.length = MAX_LOG_SIZE;
    this.persist();
    console.error('[ErrorHandler]', entry);

    const notice = this.categorise(error, context);
    this.noticeHandler?.(notice);
  }

  private categorise(error: Error, ctx: ErrorContext): ErrorNotice {
    const msg = (error?.message ?? '').toLowerCase();
    for (const rule of RULES) {
      if (rule.match(msg, ctx)) {
        return { ...rule.notice, message: rule.notice.message(msg) };
      }
    }
    return {
      kind: 'info',
      title: 'Something went wrong',
      message:
        'An unexpected error occurred. You can continue using the app, but some features might not work.',
      action: 'none',
    };
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEYS.errorLog,
        JSON.stringify(this.log.slice(0, PERSISTED_LOG_SIZE)),
      );
    } catch {
      // Quota full / unavailable — ignore, the in-memory log still works.
    }
  }

  async safeAsync<T>(fn: () => Promise<T>, context: ErrorContext = {}): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.handle(err instanceof Error ? err : new Error(String(err)), { ...context, type: 'async' });
      return null;
    }
  }

  safeSync<T>(fn: () => T, context: ErrorContext = {}, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      this.handle(err instanceof Error ? err : new Error(String(err)), { ...context, type: 'sync' });
      return fallback;
    }
  }

  exportLog(): string {
    return JSON.stringify(
      { timestamp: new Date().toISOString(), errors: this.log },
      null,
      2,
    );
  }

  clearLog(): void {
    this.log = [];
    try {
      localStorage.removeItem(STORAGE_KEYS.errorLog);
    } catch {
      // ignore
    }
  }
}
