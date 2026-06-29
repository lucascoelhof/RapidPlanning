import { html } from 'lit-html';
import { footerView } from '../components/footer';
import { LINKS } from '../../constants';

/** About page: terms of use + tech stack. */
export function aboutPageView(onHome: () => void): unknown {
  return html`
    <div class="about-page">
      <div class="about-header">
        <h1>⚡ RapidPlanning ⚡</h1>
        <nav class="about-nav">
          <a href="?page=home" @click=${(e: Event) => { e.preventDefault(); onHome(); }}>← Back to Home</a>
        </nav>
      </div>
      <div class="about-content">
        <section class="terms-section">
          <h2>Terms of Use</h2>
          <div class="terms-content">
            <p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>
            <h3>1. Acceptance of Terms</h3>
            <p>
              By accessing and using RapidPlanning, you agree to be bound by these Terms of Use and all
              applicable laws and regulations.
            </p>
            <h3>2. Description of Service</h3>
            <p>
              RapidPlanning is a web-based planning poker application that allows teams to estimate effort
              for tasks collaboratively. The service is provided "as is" without warranty of any kind.
            </p>
            <h3>3. Privacy and Data</h3>
            <p>
              We collect minimal anonymous usage data to improve the service. No personal information is
              stored permanently. Session data is temporary and automatically deleted when sessions end.
            </p>
            <h3>4. User Conduct</h3>
            <p>
              Users agree to use the service responsibly and not to engage in any activity that could harm
              the service or other users.
            </p>
            <h3>5. Limitation of Liability</h3>
            <p>
              RapidPlanning is provided free of charge. We shall not be liable for any damages arising from
              the use or inability to use this service.
            </p>
            <h3>6. Changes to Terms</h3>
            <p>
              We reserve the right to modify these terms at any time. Continued use of the service
              constitutes acceptance of modified terms.
            </p>
          </div>
        </section>
        <section class="tech-section">
          <h2>This Website</h2>
          <div class="tech-content">
            <p>
              RapidPlanning is built using modern web technologies to provide a fast, reliable, and
              user-friendly experience.
            </p>
            <h3>Technologies Used:</h3>
            <ul>
              <li><strong>Frontend:</strong> TypeScript, Vite, lit-html</li>
              <li><strong>Peer-to-Peer:</strong> PeerJS (WebRTC) for real-time communication</li>
              <li><strong>Analytics:</strong> GoatCounter (privacy-focused)</li>
              <li><strong>Hosting:</strong> GitHub Pages</li>
              <li><strong>Avatars:</strong> Gravatar integration</li>
            </ul>
            <h3>Open Source</h3>
            <p>
              This project is open source and available on GitHub. Feel free to contribute, report issues,
              or fork the project for your own use.
            </p>
            <p>
              <a href="${LINKS.repo}" target="_blank" rel="noopener noreferrer" class="github-link">
                View on GitHub →
              </a>
            </p>
          </div>
        </section>
      </div>
      ${footerView(false)}
    </div>
  `;
}
