import { EventEmitter } from './utils/event-emitter.js'

export class Router extends EventEmitter {
  constructor() {
    super()
    this.currentRoute = null
    this.popstateHandler = () => this.handleRouteChange()
  }

  init() {
    this.handleRouteChange()
    window.addEventListener('popstate', this.popstateHandler)
  }

  handleRouteChange() {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session')
    const page = params.get('page')
    
    if (sessionId && sessionId.match(/^\d{9}$/)) {
      // Session route
      this.emit('route:session', sessionId)
      this.currentRoute = `session:${sessionId}`
    } else if (page === 'about') {
      // About page
      this.emit('route:about')
      this.currentRoute = 'about'
    } else {
      // Home page (default)
      this.emit('route:home')
      this.currentRoute = 'home'
    }
  }

  navigate(route, sessionId = null) {
    const params = new URLSearchParams()
    
    if (route === 'session' && sessionId) {
      params.set('session', sessionId)
    } else if (route === 'about') {
      params.set('page', 'about')
    }
    // For home, we don't need any params
    
    const queryString = params.toString()
    const newUrl = window.location.pathname + (queryString ? '?' + queryString : '')
    
    if (window.location.href !== newUrl) {
      window.history.pushState({}, '', newUrl)
      this.handleRouteChange()
    }
  }

  cleanup() {
    window.removeEventListener('popstate', this.popstateHandler)
    this.destroy() // Clean up event listeners from EventEmitter
  }
}