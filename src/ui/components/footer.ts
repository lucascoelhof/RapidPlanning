import { html } from 'lit-html';
import { LINKS } from '../../constants';

/** Shared footer rendered on every page. */
export function footerView(showTerms = true): unknown {
  return html`
    <footer class="site-footer">
      <div class="footer-content">
        <span>
          Created by
          <a href="${LINKS.author}" target="_blank" rel="noopener noreferrer">Lucas Coelho Figueiredo</a>
        </span>
        ${showTerms
          ? html`<span class="footer-separator">•</span>
              <a href="?page=about" class="terms-link">Terms of Use</a>`
          : null}
      </div>
    </footer>
  `;
}
