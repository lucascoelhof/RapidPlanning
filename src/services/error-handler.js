// Error Handler for global error management and user-friendly error boundaries
export class ErrorHandler {
  constructor(uiManager = null) {
    this.uiManager = uiManager
    this.errorLog = []
    this.maxErrorLogSize = 50
    this.setupGlobalErrorHandling()
  }

  setupGlobalErrorHandling() {
    // Handle unhandled JavaScript errors
    window.addEventListener('error', (event) => {
      this.handleError(event.error || new Error(event.message), {
        type: 'javascript',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      })
    })

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, {
        type: 'promise',
        promise: event.promise
      })
      // Prevent the default browser behavior (logging to console)
      event.preventDefault()
    })
  }

  handleError(error, context = {}) {
    const errorInfo = {
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      timestamp: new Date().toISOString(),
      context: context,
      userAgent: navigator.userAgent,
      url: window.location.href
    }

    // Log the error
    this.logError(errorInfo)

    // Determine error severity and user message
    const userMessage = this.getUserFriendlyMessage(error, context)
    
    // Show appropriate UI response
    this.showErrorToUser(userMessage, context)

    // Log to console for debugging
    console.error('Error handled by ErrorHandler:', errorInfo)
  }

  logError(errorInfo) {
    // Add to in-memory log
    this.errorLog.unshift(errorInfo)
    
    // Keep only the most recent errors
    if (this.errorLog.length > this.maxErrorLogSize) {
      this.errorLog = this.errorLog.slice(0, this.maxErrorLogSize)
    }

    // Store recent errors in localStorage for debugging
    try {
      const recentErrors = this.errorLog.slice(0, 10) // Keep only 10 most recent
      localStorage.setItem('rapidPlanning_errorLog', JSON.stringify(recentErrors))
    } catch (e) {
      // If localStorage is full or unavailable, ignore
    }
  }

  getUserFriendlyMessage(error, context) {
    const message = error?.message?.toLowerCase() || ''
    
    // Network-related errors
    if (message.includes('fetch') || message.includes('network') || message.includes('connection')) {
      return {
        type: 'network',
        title: 'Connection Issue',
        message: 'Having trouble connecting. Please check your internet connection and try again.',
        action: 'retry',
        severity: 'warning'
      }
    }
    
    // PeerJS connection errors
    if (message.includes('peer') || message.includes('webrtc') || message.includes('datachannel')) {
      return {
        type: 'peer',
        title: 'Connection Problem',
        message: 'Unable to connect to other players. This might be due to firewall or network restrictions.',
        action: 'refresh',
        severity: 'warning'
      }
    }
    
    // Storage errors
    if (message.includes('localstorage') || message.includes('quota')) {
      return {
        type: 'storage',
        title: 'Storage Full',
        message: 'Your browser storage is full. Some features may not work properly.',
        action: 'clear_data',
        severity: 'warning'
      }
    }
    
    // Permission errors
    if (message.includes('permission') || message.includes('denied')) {
      return {
        type: 'permission',
        title: 'Permission Required',
        message: 'This feature requires browser permissions. Please check your browser settings.',
        action: 'none',
        severity: 'warning'
      }
    }
    
    // JavaScript errors in our code
    if (context.type === 'javascript' && context.filename?.includes('planning')) {
      return {
        type: 'application',
        title: 'Application Error',
        message: 'Something went wrong. The page will refresh automatically to recover.',
        action: 'auto_refresh',
        severity: 'error'
      }
    }
    
    // Generic errors
    return {
      type: 'generic',
      title: 'Something went wrong',
      message: 'An unexpected error occurred. You can continue using the app, but some features might not work.',
      action: 'dismiss',
      severity: 'info'
    }
  }

  showErrorToUser(userMessage, context) {
    if (!this.uiManager) {
      // Fallback: show browser alert if no UI manager
      alert(`${userMessage.title}: ${userMessage.message}`)
      return
    }

    // Show error modal for all errors (no more toasts)
    this.uiManager.showErrorModal(userMessage)

    // Handle specific actions
    this.handleErrorAction(userMessage.action, context)
  }

  handleErrorAction(action, context) {
    switch (action) {
      case 'retry':
        // Could implement automatic retry logic here
        break
        
      case 'refresh':
        // Show option to refresh or do it automatically after a delay
        setTimeout(() => {
          if (confirm('Would you like to refresh the page to try to fix the connection issue?')) {
            window.location.reload()
          }
        }, 2000)
        break
        
      case 'auto_refresh':
        // Automatic refresh for critical errors
        setTimeout(() => {
          window.location.reload()
        }, 3000)
        break
        
      case 'clear_data':
        // Show option to clear local storage
        setTimeout(() => {
          if (confirm('Would you like to clear stored data to free up space? (You may need to rejoin your session)')) {
            this.clearStoredData()
            window.location.reload()
          }
        }, 2000)
        break
        
      case 'dismiss':
      case 'none':
      default:
        // No action needed
        break
    }
  }

  clearStoredData() {
    try {
      // Clear RapidPlanning related data
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('rapidPlanning')) {
          localStorage.removeItem(key)
        }
      })
    } catch (e) {
      console.warn('Could not clear localStorage:', e)
    }
  }

  // Wrapper for handling async operations safely
  async safeAsync(asyncFn, context = {}) {
    try {
      return await asyncFn()
    } catch (error) {
      this.handleError(error, { ...context, type: 'async' })
      return null
    }
  }

  // Wrapper for handling sync operations safely
  safeSync(syncFn, context = {}, fallback = null) {
    try {
      return syncFn()
    } catch (error) {
      this.handleError(error, { ...context, type: 'sync' })
      return fallback
    }
  }

  // Get error statistics for debugging
  getErrorStats() {
    const stats = {
      total: this.errorLog.length,
      byType: {},
      recent: this.errorLog.slice(0, 5)
    }

    this.errorLog.forEach(error => {
      const type = error.context?.type || 'unknown'
      stats.byType[type] = (stats.byType[type] || 0) + 1
    })

    return stats
  }

  // Export error log for debugging
  exportErrorLog() {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      errors: this.errorLog
    }, null, 2)
  }

  // Clear error log
  clearErrorLog() {
    this.errorLog = []
    try {
      localStorage.removeItem('rapidPlanning_errorLog')
    } catch (e) {
      // Ignore
    }
  }
}