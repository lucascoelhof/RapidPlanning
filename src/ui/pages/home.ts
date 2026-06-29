import { html } from 'lit-html';
import { footerView } from '../components/footer';

/** Home page: create-session and join-session forms side by side. */
export function homePageView(callbacks: {
  onCreate: (rawIdentity: string) => void;
  onJoin: (sessionId: string, rawIdentity: string) => void;
  onNavigateAbout: () => void;
}): unknown {
  return html`
    <div class="home-page">
      <div class="home-content">
        <h1>⚡ RapidPlanning ⚡</h1>
        <div class="home-actions">
          <div class="card">
            <h2>Create Session</h2>
            <form
              id="create-form"
              @submit=${(e: Event) => {
                e.preventDefault();
                const input = document.getElementById('create-identity') as HTMLInputElement | null;
                const value = input?.value.trim();
                if (value) callbacks.onCreate(value);
              }}
            >
              <div class="form-group">
                <label for="create-identity">Your Name or Email</label>
                <input
                  type="text"
                  id="create-identity"
                  required
                  maxlength="70"
                  placeholder="John Doe or john@example.com"
                  autocomplete="name"
                />
                <small class="form-hint">Enter your name or email address (for Gravatar)</small>
              </div>
              <button type="submit" class="btn">Create Session</button>
            </form>
          </div>

          <div class="card">
            <h2>Join Session</h2>
            <form
              id="join-form"
              @submit=${(e: Event) => {
                e.preventDefault();
                const sessionEl = document.getElementById('join-session') as HTMLInputElement | null;
                const identityEl = document.getElementById('join-identity') as HTMLInputElement | null;
                const sessionId = sessionEl?.value.trim() ?? '';
                const identity = identityEl?.value.trim() ?? '';
                if (/^\d{9}$/.test(sessionId) && identity) {
                  callbacks.onJoin(sessionId, identity);
                }
              }}
            >
              <div class="form-group">
                <label for="join-session">Session ID</label>
                <input
                  type="text"
                  id="join-session"
                  required
                  pattern="\\d{9}"
                  maxlength="9"
                  placeholder="123456789"
                  inputmode="numeric"
                />
              </div>
              <div class="form-group">
                <label for="join-identity">Your Name or Email</label>
                <input
                  type="text"
                  id="join-identity"
                  required
                  maxlength="70"
                  placeholder="Jane Doe or jane@example.com"
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
