import md5 from 'crypto-js/md5';
import { LINKS } from '../constants';
import type { PlayerIdentity } from '../app/types';

/**
 * Gravatar integration. Replaces the legacy mix of MD5 hashing + JSONP
 * profile fetching that lived inside UIManager.
 *
 * - `buildIdentity()` is fully deterministic and synchronous except for the
 *   optional profile-name fetch (which has a hard timeout and resolves to the
 *   fallback on any failure).
 * - The JSONP transport is wrapped so it always cleans up its `<script>` tag
 *   and global callback, even on timeout/error.
 */

export interface ParsedIdentity {
  /** Display name to use right now (may be refined after Gravatar lookup). */
  name: string;
  email: string | null;
  /** Whether we should attempt a Gravatar profile lookup. */
  hasEmail: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a raw form input into name/email components. */
export function parseIdentity(raw: string): ParsedIdentity {
  const value = raw.trim();
  if (EMAIL_PATTERN.test(value)) {
    const localPart = value.split('@')[0]!;
    const tempName = localPart
      .replace(/[._-]/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    return { name: tempName || localPart, email: value, hasEmail: true };
  }
  return { name: value, email: null, hasEmail: false };
}

/** MD5-hash an email for Gravatar (lowercased + trimmed, per Gravatar spec). */
export function gravatarHash(email: string): string {
  return md5(email.toLowerCase().trim()).toString();
}

/**
 * Build the full PlayerIdentity from a raw form input.
 *
 * If `email` is present, fetches the Gravatar profile to refine the display
 * name; falls back to the parsed name on any failure or after `timeoutMs`.
 */
export async function buildIdentity(
  raw: string,
  timeoutMs = 3_000,
): Promise<PlayerIdentity> {
  const parsed = parseIdentity(raw);
  if (!parsed.hasEmail || parsed.email === null) {
    return { name: parsed.name, email: null, avatar: null };
  }
  const hash = gravatarHash(parsed.email);
  const avatar = LINKS.gravatarAvatar(hash);
  let name = parsed.name;
  try {
    const gravatarName = await fetchGravatarName(hash, parsed.name, timeoutMs);
    if (gravatarName) name = gravatarName;
  } catch {
    // Fall back to parsed name — never let Gravatar failure block onboarding.
  }
  return { name, email: parsed.email, avatar };
}

/**
 * Fetch a Gravatar display name via JSONP (avoids CORS). Returns the
 * fallback if the profile is missing, malformed, or times out.
 *
 * Exposed (not exported) for monkeypatching in tests.
 */
export function fetchGravatarName(
  hash: string,
  fallback: string,
  timeoutMs = 3_000,
): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(fallback);
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const callbackName = `__gravatarCb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      delete w[callbackName];
      script.remove();
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(fallback);
    }, timeoutMs);

    w[callbackName] = (data: unknown) => {
      window.clearTimeout(timeout);
      const entry = (data as { entry?: Array<Record<string, unknown>> })?.entry?.[0];
      const profileName =
        (entry?.['displayName'] as string | undefined) ??
        (entry?.['name'] as { formatted?: string } | undefined)?.formatted ??
        (entry?.['preferredUsername'] as string | undefined);
      cleanup();
      resolve(profileName || fallback);
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(fallback);
    };
    script.src = `${LINKS.gravatarProfile(hash)}?callback=${callbackName}`;
    document.head.appendChild(script);
  });
}
