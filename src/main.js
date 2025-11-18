import { RapidPlanningApp } from './app.js'

const app = new RapidPlanningApp()
app.init()

// Make app available globally for testing
window.app = app
