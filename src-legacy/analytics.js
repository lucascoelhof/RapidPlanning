// Analytics service for GoatCounter
class Analytics {
  constructor() {
    // Check if GoatCounter will be available (it loads async)
    this.waitForGoatCounter();
  }
  
  waitForGoatCounter() {
    // Since GoatCounter loads async, we need to wait for it
    if (typeof window !== 'undefined') {
      // Check if already loaded
      if (window.goatcounter) {
        this.isEnabled = true;
      } else {
        // Wait for it to load
        const checkInterval = setInterval(() => {
          if (window.goatcounter) {
            this.isEnabled = true;
            clearInterval(checkInterval);
          }
        }, 100);
        
        // Stop checking after 5 seconds
        setTimeout(() => clearInterval(checkInterval), 5000);
      }
    }
  }

  // Track a custom event
  trackEvent(eventName, metadata = {}) {
    if (!this.isEnabled) {
      // Queue the event to send when GoatCounter is ready
      setTimeout(() => this.trackEvent(eventName, metadata), 500);
      return;
    }

    try {
      // GoatCounter tracks events as path-like strings
      // Format: /event/category/action
      const path = `/event/${eventName}`;
      
      // Send to GoatCounter
      window.goatcounter.count({
        path: path,
        title: eventName.replace(/-/g, ' '),
        event: true
      });
    } catch (error) {
      console.error('Failed to track event:', error);
    }
  }

  // Track specific app events
  trackRoomCreated() {
    this.trackEvent('room-created');
  }

  trackUserJoined(isHost = false) {
    this.trackEvent(isHost ? 'host-joined' : 'participant-joined');
  }

  trackVotingStarted() {
    this.trackEvent('voting-round-started');
  }

  trackVoteSubmitted() {
    this.trackEvent('vote-submitted');
  }

  trackVotesRevealed() {
    this.trackEvent('votes-revealed');
  }

  trackRoomLeft() {
    this.trackEvent('room-left');
  }

  // Track page views (GoatCounter does this automatically, but this is for SPA navigation)
  trackPageView(path) {
    if (!this.isEnabled) return;

    try {
      window.goatcounter.count({
        path: path || window.location.pathname
      });
    } catch (error) {
      console.error('Failed to track page view:', error);
    }
  }
}

// Export singleton instance
export const analytics = new Analytics();