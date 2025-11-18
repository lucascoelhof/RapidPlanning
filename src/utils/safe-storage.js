// Safe LocalStorage wrapper with error handling
export class SafeStorage {
  constructor() {
    this.available = this.checkAvailability()
    this.fallbackStorage = new Map() // In-memory fallback
  }

  checkAvailability() {
    try {
      const test = '__storage_test__'
      localStorage.setItem(test, test)
      localStorage.removeItem(test)
      return true
    } catch (e) {
      console.warn('LocalStorage not available, using in-memory fallback:', e.message)
      return false
    }
  }

  getItem(key) {
    if (!this.available) {
      return this.fallbackStorage.get(key) || null
    }

    try {
      return localStorage.getItem(key)
    } catch (e) {
      console.warn(`Error reading from localStorage (key: ${key}):`, e.message)
      return this.fallbackStorage.get(key) || null
    }
  }

  setItem(key, value) {
    // Try localStorage first
    if (this.available) {
      try {
        localStorage.setItem(key, value)
        // Also cache in memory as backup
        this.fallbackStorage.set(key, value)
        return true
      } catch (e) {
        // Handle quota exceeded or other errors
        if (e.name === 'QuotaExceededError') {
          console.warn('LocalStorage quota exceeded, attempting cleanup...')
          if (this.attemptCleanup()) {
            // Try again after cleanup
            try {
              localStorage.setItem(key, value)
              this.fallbackStorage.set(key, value)
              return true
            } catch (retryError) {
              console.warn('Failed to set item even after cleanup:', retryError.message)
            }
          }
        } else {
          console.warn(`Error writing to localStorage (key: ${key}):`, e.message)
        }

        // Fall back to in-memory storage
        this.fallbackStorage.set(key, value)
        return false
      }
    } else {
      // LocalStorage not available, use fallback
      this.fallbackStorage.set(key, value)
      return false
    }
  }

  removeItem(key) {
    if (this.available) {
      try {
        localStorage.removeItem(key)
      } catch (e) {
        console.warn(`Error removing from localStorage (key: ${key}):`, e.message)
      }
    }
    this.fallbackStorage.delete(key)
  }

  clear() {
    if (this.available) {
      try {
        localStorage.clear()
      } catch (e) {
        console.warn('Error clearing localStorage:', e.message)
      }
    }
    this.fallbackStorage.clear()
  }

  attemptCleanup() {
    try {
      // Get all rapidPlanning keys
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('rapidPlanning')) {
          keys.push(key)
        }
      }

      // Sort by lastUpdated timestamp if available
      const sessions = {}
      keys.forEach(key => {
        try {
          const data = JSON.parse(localStorage.getItem(key))
          if (data && typeof data === 'object') {
            sessions[key] = data.lastUpdated || data.joinedAt || 0
          }
        } catch (e) {
          // Invalid JSON, mark for deletion
          sessions[key] = 0
        }
      })

      // Sort keys by timestamp (oldest first)
      const sortedKeys = Object.keys(sessions).sort((a, b) => sessions[a] - sessions[b])

      // Remove oldest 50% of entries
      const toRemove = Math.ceil(sortedKeys.length / 2)
      for (let i = 0; i < toRemove; i++) {
        localStorage.removeItem(sortedKeys[i])
        console.log(`Removed old session data: ${sortedKeys[i]}`)
      }

      return toRemove > 0
    } catch (e) {
      console.warn('Error during storage cleanup:', e.message)
      return false
    }
  }

  // Safe JSON parse
  getJSON(key, defaultValue = null) {
    const value = this.getItem(key)
    if (!value) return defaultValue

    try {
      return JSON.parse(value)
    } catch (e) {
      console.warn(`Error parsing JSON from localStorage (key: ${key}):`, e.message)
      // Try to remove corrupted data
      this.removeItem(key)
      return defaultValue
    }
  }

  // Safe JSON stringify and set
  setJSON(key, value) {
    try {
      const jsonString = JSON.stringify(value)
      return this.setItem(key, jsonString)
    } catch (e) {
      console.warn(`Error stringifying JSON for localStorage (key: ${key}):`, e.message)
      return false
    }
  }

  // Get storage info
  getStorageInfo() {
    if (!this.available) {
      return {
        available: false,
        using: 'memory',
        keys: this.fallbackStorage.size
      }
    }

    try {
      let totalSize = 0
      let rapidPlanningSize = 0
      let rapidPlanningKeys = 0

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        const value = localStorage.getItem(key)
        const size = new Blob([key, value]).size

        totalSize += size

        if (key && key.startsWith('rapidPlanning')) {
          rapidPlanningSize += size
          rapidPlanningKeys++
        }
      }

      return {
        available: true,
        using: 'localStorage',
        totalKeys: localStorage.length,
        rapidPlanningKeys,
        totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
        rapidPlanningSize: `${(rapidPlanningSize / 1024).toFixed(2)} KB`
      }
    } catch (e) {
      return {
        available: true,
        using: 'localStorage',
        error: e.message
      }
    }
  }
}

// Export singleton instance
export const safeStorage = new SafeStorage()
