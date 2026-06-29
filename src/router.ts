import { Emitter } from './utils/emitter';

/**
 * Query-parameter router. GitHub Pages doesn't support path-based client
 * routing, so everything lives in `?session=` / `?page=`.
 *
 * Routes:
 *   - `home`            — no params
 *   - `session:<id>`    — `?session=123456789`
 *   - `about`           — `?page=about`
 */

export type Route =
  | { name: 'home' }
  | { name: 'session'; sessionId: string }
  | { name: 'about' };

interface RouterEvents {
  route: [route: Route];
}

const SESSION_RE = /^\d{9}$/;

export class Router extends Emitter<RouterEvents> {
  init(): void {
    this.handleRouteChange();
    window.addEventListener('popstate', () => this.handleRouteChange());
  }

  private handleRouteChange(): void {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const page = params.get('page');
    let route: Route;
    if (session && SESSION_RE.test(session)) {
      route = { name: 'session', sessionId: session };
    } else if (page === 'about') {
      route = { name: 'about' };
    } else {
      route = { name: 'home' };
    }
    this.emit('route', route);
  }

  navigate(route: Route): void {
    const params = new URLSearchParams();
    if (route.name === 'session') params.set('session', route.sessionId);
    else if (route.name === 'about') params.set('page', 'about');
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : '');
    if (window.location.href !== newUrl) {
      window.history.pushState({}, '', newUrl);
      this.handleRouteChange();
    }
  }
}
