import { STORAGE_KEYS, THEMES, type Theme } from '../constants';

/**
 * Theme controller. Applies the saved (or default) theme by setting
 * `data-theme` on `<html>` and persists changes to localStorage.
 *
 * The legacy app duplicated theme state across UIManager and the DOM; here
 * it's a single tiny module.
 */
class ThemeController {
  private current: Theme = 'dark';

  init(): Theme {
    const saved = this.readSaved();
    this.current = saved;
    this.apply(saved);
    return saved;
  }

  get(): Theme {
    return this.current;
  }

  set(theme: Theme): void {
    this.current = theme;
    this.apply(theme);
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // ignore
    }
  }

  private apply(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }

  private readSaved(): Theme {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.theme);
      if (raw && (THEMES as readonly string[]).includes(raw)) return raw as Theme;
    } catch {
      // ignore
    }
    return 'dark';
  }
}

export const theme = new ThemeController();
