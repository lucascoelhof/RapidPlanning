// Base EventEmitter class for consistent event handling across all managers
export class EventEmitter {
  constructor() {
    this.events = {}
  }

  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(callback)

    // Return unsubscribe function for convenience
    return () => this.off(event, callback)
  }

  off(event, callback) {
    if (!this.events[event]) return

    if (callback) {
      // Remove specific callback
      this.events[event] = this.events[event].filter(cb => cb !== callback)
    } else {
      // Remove all callbacks for this event
      delete this.events[event]
    }
  }

  emit(event, ...args) {
    if (!this.events[event]) return

    // Create a copy to avoid issues if handlers modify the array
    const callbacks = [...this.events[event]]

    callbacks.forEach(callback => {
      try {
        callback(...args)
      } catch (error) {
        console.error(`Error in event handler for '${event}':`, error)
      }
    })
  }

  once(event, callback) {
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper)
      callback(...args)
    }
    this.on(event, onceWrapper)
  }

  removeAllListeners(event) {
    if (event) {
      delete this.events[event]
    } else {
      this.events = {}
    }
  }

  listenerCount(event) {
    return this.events[event]?.length || 0
  }

  // Cleanup method to remove all event listeners
  destroy() {
    this.removeAllListeners()
  }
}
