import { Session } from './app/session';
import { UIController } from './ui/controller';

/**
 * App entry point. Wires the Session (coordinator) to the UIController
 * (renderer), kicks off routing, and registers the unload cleanup.
 */
async function bootstrap(): Promise<void> {
  const session = new Session();
  const ui = new UIController(session);
  ui.init();
  session.router.init();

  // Clean up peer connections + intervals when the page is closed/refreshed.
  // `pagehide` fires more reliably than `beforeunload` (especially on mobile);
  // we register both since cleanup is idempotent.
  const cleanup = (): void => session.cleanup();
  window.addEventListener('pagehide', cleanup);
  window.addEventListener('beforeunload', cleanup);

  // Expose for debugging in dev (read-only via console).
  if (import.meta.env.DEV) {
    (window as unknown as { app?: unknown }).app = session;
  }
}

void bootstrap();
