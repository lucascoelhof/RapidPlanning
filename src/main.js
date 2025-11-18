import { RapidPlanningApp } from './app.js'
import { DependencyLoader } from './services/dependency-loader.js'

// Show loading screen
const loadingScreen = document.createElement('div')
loadingScreen.id = 'dependency-loading'
loadingScreen.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #0f172a;
  color: #e2e8f0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
`
loadingScreen.innerHTML = `
  <h1 style="font-size: 48px; margin-bottom: 16px;">⚡ RapidPlanning ⚡</h1>
  <p style="font-size: 18px; color: #94a3b8;">Loading dependencies...</p>
  <div style="margin-top: 24px; width: 40px; height: 40px; border: 4px solid #334155; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
  <style>
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
`
document.body.appendChild(loadingScreen)

// Load dependencies before initializing app
const loader = new DependencyLoader()

loader.loadAll().then(result => {
  if (result.success) {
    // Dependencies loaded successfully
    console.log('All dependencies loaded successfully')
    loadingScreen.remove()

    const app = new RapidPlanningApp()
    app.init()

    // Make app available globally for testing
    window.app = app
  } else {
    // Failed to load dependencies
    console.error('Failed to load dependencies:', result.error)
    showDependencyError(result)
  }
}).catch(error => {
  console.error('Unexpected error loading dependencies:', error)
  showDependencyError({ error: error.message, missingDependencies: [] })
})

function showDependencyError(result) {
  loadingScreen.innerHTML = `
    <div style="max-width: 600px; padding: 32px; text-align: center;">
      <div style="font-size: 64px; margin-bottom: 24px;">⚠️</div>
      <h1 style="font-size: 32px; margin-bottom: 16px;">Unable to Load RapidPlanning</h1>
      <p style="font-size: 18px; color: #94a3b8; margin-bottom: 24px; line-height: 1.6;">
        We couldn't load the required libraries needed to run RapidPlanning. This might be due to:
      </p>
      <ul style="text-align: left; color: #94a3b8; margin-bottom: 32px; line-height: 1.8;">
        <li>Network connectivity issues</li>
        <li>Browser extensions blocking scripts (ad blockers, privacy tools)</li>
        <li>Firewall or corporate network restrictions</li>
        <li>CDN services being unavailable</li>
      </ul>
      ${result.missingDependencies?.length > 0 ? `
        <p style="font-size: 16px; color: #ef4444; margin-bottom: 24px;">
          Missing: ${result.missingDependencies.join(', ')}
        </p>
      ` : ''}
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button onclick="window.location.reload()" style="
          background: #3b82f6;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
        ">
          🔄 Retry
        </button>
        <button onclick="window.open('https://github.com/lucascoelhof/RapidPlanning/issues', '_blank')" style="
          background: transparent;
          color: #94a3b8;
          border: 2px solid #94a3b8;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
        ">
          🐛 Report Issue
        </button>
      </div>
    </div>
  `
}
