import { html } from 'lit-html';
import { footerView } from '../components/footer';

/** Join-prompt page: shown when visiting `?session=` with no stored identity. */
export function joinPromptView(
  sessionId: string,
  onJoin: (rawIdentity: string) => void,
): unknown {
  return html`
    <div class="home-page">
      <div class="home-content">
        <h1>⚡ RapidPlanning ⚡</h1>
        <div class="home-actions">
          <div class="card" style="max-width: 400px; margin: 0 auto;">
            <h2>Join Session ${sessionId}</h2>
            <p class="form-hint" style="margin-bottom: 1.5rem;">
              Enter your name to join this planning session.
            </p>
            <form
              id="join-prompt-form"
              @submit=${(e: Event) => {
                e.preventDefault();
                const input = document.getElementById('join-prompt-identity') as HTMLInputElement | null;
                const value = input?.value.trim();
                if (value) onJoin(value);
              }}
            >
              <div class="form-group">
                <label for="join-prompt-identity">Your Name or Email</label>
                <input
                  type="text"
                  id="join-prompt-identity"
                  required
                  maxlength="70"
                  placeholder="John Doe or john@example.com"
                  autofocus
                  autocomplete="name"
                />
                <small class="form-hint">Enter your name or email address (for Gravatar)</small>
              </div>
              <button type="submit" class="btn">Join Session</button>
            </form>
          </div>
        </div>
      </div>
      ${footerView(true)}
    </div>
  `;
}
