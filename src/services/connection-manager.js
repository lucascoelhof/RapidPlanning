// Connection Manager for handling network states and graceful degradation
export class ConnectionManager {
  constructor() {
    this.events = {}
    this.isOnline = navigator.onLine
    this.connectionQuality = 'good' // good, poor, offline
    this.retryAttempts = 0
    this.maxRetryAttempts = 3
    this.retryDelay = 1000
    this.lastHeartbeat = Date.now()
    this.heartbeatInterval = null
    this.reconnectTimeout = null
    
    this.setupEventListeners()
    this.startHeartbeat()
  }

  setupEventListeners() {
    // Browser online/offline events
    window.addEventListener('online', () => {
      this.handleOnlineStatusChange(true)
    })
    
    window.addEventListener('offline', () => {
      this.handleOnlineStatusChange(false)
    })
    
    // Page visibility changes (tab switching, minimizing)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.handlePageVisible()
      } else {
        this.handlePageHidden()
      }
    })
  }

  handleOnlineStatusChange(isOnline) {
    const wasOnline = this.isOnline
    this.isOnline = isOnline
    
    if (isOnline && !wasOnline) {
      this.connectionQuality = 'good'
      this.retryAttempts = 0
      this.emit('connectionRestored')
    } else if (!isOnline && wasOnline) {
      this.connectionQuality = 'offline'
      this.emit('connectionLost')
    }
    
    this.emit('statusChange', { 
      isOnline: this.isOnline, 
      quality: this.connectionQuality 
    })
  }

  handlePageVisible() {
    // Resume heartbeat when page becomes visible
    this.startHeartbeat()
    this.emit('pageVisible')
  }

  handlePageHidden() {
    // Pause heartbeat when page is hidden to save resources
    this.stopHeartbeat()
    this.emit('pageHidden')
  }

  startHeartbeat() {
    if (this.heartbeatInterval) return
    
    this.heartbeatInterval = setInterval(() => {
      this.checkConnectionHealth()
    }, 30000) // Check every 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  checkConnectionHealth() {
    if (!this.isOnline) return
    
    // Simple connection test using a small image request
    const startTime = Date.now()
    const img = new Image()
    
    const timeout = setTimeout(() => {
      this.handleConnectionTest(false, Date.now() - startTime)
    }, 5000) // 5 second timeout
    
    img.onload = () => {
      clearTimeout(timeout)
      this.handleConnectionTest(true, Date.now() - startTime)
    }
    
    img.onerror = () => {
      clearTimeout(timeout)
      this.handleConnectionTest(false, Date.now() - startTime)
    }
    
    // Use a small, fast-loading image (1x1 pixel)
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  }

  handleConnectionTest(success, responseTime) {
    this.lastHeartbeat = Date.now()
    
    if (success) {
      if (responseTime < 1000) {
        this.connectionQuality = 'good'
      } else if (responseTime < 3000) {
        this.connectionQuality = 'poor'
      } else {
        this.connectionQuality = 'very-poor'
      }
      this.retryAttempts = 0
    } else {
      this.retryAttempts++
      if (this.retryAttempts >= this.maxRetryAttempts) {
        this.connectionQuality = 'offline'
        this.emit('connectionDegraded', { quality: this.connectionQuality })
      }
    }
    
    this.emit('heartbeat', { 
      success, 
      responseTime, 
      quality: this.connectionQuality 
    })
  }

  // Attempt to reconnect with exponential backoff
  attemptReconnection(callback) {
    if (this.reconnectTimeout) return
    
    const delay = this.retryDelay * Math.pow(2, this.retryAttempts)
    console.log(`Attempting reconnection in ${delay}ms (attempt ${this.retryAttempts + 1})`)
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      
      if (this.isOnline) {
        callback()
          .then(() => {
            this.retryAttempts = 0
            this.connectionQuality = 'good'
            this.emit('reconnected')
          })
          .catch((error) => {
            this.retryAttempts++
            if (this.retryAttempts < this.maxRetryAttempts) {
              this.attemptReconnection(callback)
            } else {
              this.emit('reconnectionFailed', error)
            }
          })
      }
    }, delay)
  }

  // Get user-friendly status message
  getStatusMessage() {
    if (!this.isOnline) {
      return {
        type: 'error',
        message: 'You\'re offline. Some features may not work.',
        icon: 'Offline'
      }
    }
    
    switch (this.connectionQuality) {
      case 'good':
        return null // Don't show anything when connected properly
      case 'poor':
        return {
          type: 'warning',
          message: 'Poor connection. Some delays expected.',
          icon: 'Slow'
        }
      case 'very-poor':
        return {
          type: 'warning',
          message: 'Very slow connection. Features may be limited.',
          icon: 'Very Slow'
        }
      case 'offline':
        return {
          type: 'error',
          message: 'Connection lost. Working in offline mode.',
          icon: 'Offline'
        }
      default:
        return null // Don't show "Checking connection" message
    }
  }

  // Enable offline mode features
  enableOfflineMode() {
    // In offline mode, we can still:
    // - Show the UI
    // - Allow local interactions
    // - Queue actions for when connection returns
    // - Show cached data
    
    this.emit('offlineModeEnabled')
  }

  // Cleanup
  destroy() {
    this.stopHeartbeat()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    window.removeEventListener('online', this.handleOnlineStatusChange)
    window.removeEventListener('offline', this.handleOnlineStatusChange)
    document.removeEventListener('visibilitychange', this.handlePageVisible)
  }

  // Event system
  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(callback)
  }

  off(event, callback) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(cb => cb !== callback)
    }
  }

  emit(event, data) {
    if (this.events[event]) {
      this.events[event].forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.warn('Error in connection manager event handler:', error)
        }
      })
    }
  }
}