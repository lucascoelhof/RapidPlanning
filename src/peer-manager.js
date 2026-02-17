// PeerJS is loaded globally from CDN
const Peer = window.Peer;

export class PeerManager {
  constructor() {
    this.peer = null
    this.connections = new Map()
    this.events = {}
    this.sessionId = null
    this.isHost = false

    // Connection resilience improvements
    this.heartbeatInterval = null
    this.keepaliveInterval = null
    this.connectionHealth = new Map()
    this.maxRetries = 3
    this.retryDelay = 2000
    this.connectionTimeout = 20000 // Increased to 20 seconds for poor connections

    // Additional ICE servers for better NAT traversal
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:stun.synology.com:3478' }
    ]
  }

  async createSession(sessionId) {
    // Check if already connected
    if (this.peer && this.peer.open) {
      console.log('Already connected to peer network, not creating new connection')
      return Promise.resolve()
    }

    // Clean up any stale peer connection
    if (this.peer && !this.peer.open) {
      console.log('Cleaning up stale peer connection')
      this.cleanupPeer()
    }

    this.sessionId = sessionId
    this.isHost = true

    return new Promise((resolve, reject) => {
      console.log('Creating new peer connection for hosting session')

      let resolved = false
      let timeoutId = null

      // Try the default PeerJS cloud service first
      this.peer = new Peer(`host-${sessionId}`, {
        debug: 1,
        config: {
          iceServers: this.iceServers
        },
        // Add connection options for better reliability
        reliable: true
      })

      this.peer.on('open', (id) => {
        console.log('Host peer connected with ID:', id)
        this.emit('connected', id)

        // Clear the connection timeout
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }

        // Start keepalive after connection is established
        this.startKeepalive()

        resolved = true
        resolve()
      })

      this.peer.on('connection', (conn) => {
        console.log('Received connection request from:', conn.peer, 'Open:', conn.open)

        // Prevent duplicate connections
        if (this.connections.has(conn.peer)) {
          console.log('Duplicate connection from', conn.peer, 'closing')
          conn.close()
          return
        }

        // Set up handlers for the connection
        this.setupConnectionHandlers(conn)

        // Handle the connection when it opens
        if (conn.open) {
          console.log('Incoming connection already open')
          this.handleIncomingConnection(conn)
        } else {
          // Wait for connection to open with timeout
          const openTimeout = setTimeout(() => {
            if (!this.connections.has(conn.peer)) {
              console.warn('Incoming connection timeout for:', conn.peer)
              conn.close()
            }
          }, 10000)

          conn.on('open', () => {
            clearTimeout(openTimeout)
            console.log('Incoming connection opened from:', conn.peer)
            this.handleIncomingConnection(conn)
          })
        }
      })

      this.peer.on('error', (error) => {
        console.error('Peer error:', error)
        if (!resolved) {
          if (timeoutId) {
            clearTimeout(timeoutId)
          }
          this.cleanupPeer()
          reject(this.createFriendlyError(error))
        }
      })

      // Connection timeout with increased duration for poor connections
      timeoutId = setTimeout(() => {
        if (!resolved) {
          console.error('Connection timeout - peer did not open')
          this.cleanupPeer()
          reject(new Error('Connection timeout - Unable to connect to the peer network. This may be due to firewall restrictions. Please try again or use a different network.'))
        }
      }, this.connectionTimeout)
    })
  }

  async joinSession(sessionId, retryCount = 0) {
    // Check if already connected
    if (this.peer && this.peer.open) {
      console.log('Already connected to peer network, not creating new connection')
      return Promise.resolve()
    }

    // Clean up any stale peer connection
    if (this.peer && !this.peer.open) {
      console.log('Cleaning up stale peer connection')
      this.cleanupPeer()
    }

    this.sessionId = sessionId
    this.isHost = false

    return new Promise((resolve, reject) => {
      console.log('Creating new peer connection for joining session')

      let peerResolved = false
      let hostConnectionResolved = false
      let peerTimeoutId = null
      let hostTimeoutId = null

      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: this.iceServers
        },
        reliable: true
      })

      this.peer.on('open', (id) => {
        console.log('Client peer connected with ID:', id)
        this.emit('connected', id)
        peerResolved = true

        // Clear peer connection timeout
        if (peerTimeoutId) {
          clearTimeout(peerTimeoutId)
          peerTimeoutId = null
        }

        // Start keepalive after connection is established
        this.startKeepalive()

        // Connect to host
        const hostConnection = this.peer.connect(`host-${sessionId}`, {
          reliable: true
        })

        // Set up handlers BEFORE checking if open (fix race condition)
        this.setupConnectionHandlers(hostConnection)

        // Check if connection is already open
        if (hostConnection.open) {
          console.log('Connection to host already open')
          this.handleOutgoingConnection(hostConnection)
          hostConnectionResolved = true
          if (hostTimeoutId) {
            clearTimeout(hostTimeoutId)
            hostTimeoutId = null
          }
          resolve()
        } else {
          // Wait for connection to open
          hostConnection.on('open', () => {
            console.log('Connected to host')
            if (!hostConnectionResolved) {
              this.handleOutgoingConnection(hostConnection)
              hostConnectionResolved = true
              if (hostTimeoutId) {
                clearTimeout(hostTimeoutId)
                hostTimeoutId = null
              }
              resolve()
            }
          })
        }

        hostConnection.on('error', (error) => {
          console.error('Connection to host failed:', error)
          if (!hostConnectionResolved) {
            if (hostTimeoutId) {
              clearTimeout(hostTimeoutId)
              hostTimeoutId = null
            }
            this.cleanupPeer()
            reject(new Error('Failed to connect to session - The host may be offline, the session ID is invalid, or firewall restrictions are blocking the connection.'))
          }
        })

        // Timeout for host connection
        hostTimeoutId = setTimeout(() => {
          if (!hostConnectionResolved) {
            console.error('Connection timeout - host connection did not open')
            this.cleanupPeer()
            reject(new Error('Connection timeout - Unable to reach the session host within the time limit. The host may be offline, the session may not exist, or network restrictions may be preventing the connection.'))
          }
        }, this.connectionTimeout)
      })

      this.peer.on('connection', (conn) => {
        console.log('Received connection request from:', conn.peer, 'Open:', conn.open)

        // Prevent duplicate connections
        if (this.connections.has(conn.peer)) {
          console.log('Duplicate connection from', conn.peer, 'closing')
          conn.close()
          return
        }

        // Set up handlers for the connection
        this.setupConnectionHandlers(conn)

        // Handle the connection when it opens
        if (conn.open) {
          console.log('Incoming connection already open')
          this.handleIncomingConnection(conn)
        } else {
          // Wait for connection to open with timeout
          const openTimeout = setTimeout(() => {
            if (!this.connections.has(conn.peer)) {
              console.warn('Incoming connection timeout for:', conn.peer)
              conn.close()
            }
          }, 10000)

          conn.on('open', () => {
            clearTimeout(openTimeout)
            console.log('Incoming connection opened from:', conn.peer)
            this.handleIncomingConnection(conn)
          })
        }
      })

      this.peer.on('error', (error) => {
        console.error('Peer error:', error)
        if (!peerResolved) {
          if (peerTimeoutId) {
            clearTimeout(peerTimeoutId)
          }
          this.cleanupPeer()
          reject(this.createFriendlyError(error))
        }
      })

      // Timeout for initial peer creation
      peerTimeoutId = setTimeout(() => {
        if (!peerResolved) {
          console.error('Connection timeout - peer did not open')
          this.cleanupPeer()
          reject(new Error('Connection timeout - Unable to connect to the peer network. This may be due to firewall restrictions or network issues. Please try again or check your internet connection.'))
        }
      }, this.connectionTimeout)
    })
  }

  setupConnectionHandlers(conn) {
    // Set up data, close, and error handlers immediately
    conn.on('data', (data) => {
      console.log('Data received from', conn.peer, ':', data)
      this.handlePeerData(conn.peer, data)
      // Update health on successful data reception
      this.updateConnectionHealth(conn.peer, true)
    })

    conn.on('close', () => {
      console.log('Connection closed for:', conn.peer)
      this.connections.delete(conn.peer)
      this.connectionHealth.delete(conn.peer)
      this.emit('peerDisconnected', conn.peer)

      // Attempt to reconnect if this wasn't a clean disconnect and we're not the host
      // (Host doesn't reconnect to clients, clients may reconnect to host)
      if (!this.isHost && conn.peer.startsWith('host-') && this.peer?.open) {
        this.attemptReconnectToHost(conn.peer)
      }
    })

    conn.on('error', (error) => {
      console.error('Connection error for', conn.peer, ':', error)
      // Update health on error
      this.updateConnectionHealth(conn.peer, false)
      // Don't delete connection on error, let close event handle it
    })
  }

  // Start keepalive to prevent WebRTC connections from timing out
  startKeepalive() {
    // Clear existing keepalive if any
    this.stopKeepalive()

    // Send keepalive every 15 seconds to keep connections alive
    this.keepaliveInterval = setInterval(() => {
      this.sendKeepalive()
    }, 15000)

    // Check connection health every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.checkConnectionHealth()
    }, 30000)
  }

  // Stop keepalive
  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // Send keepalive ping to all connections
  sendKeepalive() {
    if (!this.peer || !this.peer.open) return

    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        try {
          conn.send({ type: 'keepalive', timestamp: Date.now() })
        } catch (error) {
          console.warn('Failed to send keepalive to', peerId, ':', error)
          this.updateConnectionHealth(peerId, false)
        }
      }
    })
  }

  // Update connection health status
  updateConnectionHealth(peerId, isHealthy) {
    const health = this.connectionHealth.get(peerId) || {
      healthy: true,
      lastSeen: Date.now(),
      consecutiveFailures: 0
    }

    health.lastSeen = Date.now()

    if (isHealthy) {
      health.consecutiveFailures = 0
      health.healthy = true
    } else {
      health.consecutiveFailures++
      // Mark as unhealthy after 3 consecutive failures
      if (health.consecutiveFailures >= 3) {
        health.healthy = false
        console.warn('Connection to', peerId, 'marked as unhealthy')
      }
    }

    this.connectionHealth.set(peerId, health)
  }

  // Check connection health and attempt recovery for stale connections
  checkConnectionHealth() {
    const now = Date.now()
    const staleThreshold = 60000 // 60 seconds without activity

    this.connectionHealth.forEach((health, peerId) => {
      const timeSinceLastSeen = now - health.lastSeen

      if (timeSinceLastSeen > staleThreshold && health.healthy) {
        console.warn('Connection to', peerId, 'appears stale (last seen', timeSinceLastSeen, 'ms ago)')

        // Try to send a ping to check if connection is still alive
        const conn = this.connections.get(peerId)
        if (conn && conn.open) {
          try {
            conn.send({ type: 'ping', timestamp: Date.now() })
            health.healthy = false // Temporarily mark unhealthy until we get a response
            this.connectionHealth.set(peerId, health)
          } catch (error) {
            console.error('Failed to send ping to stale peer', peerId, ':', error)
            this.handleStaleConnection(peerId)
          }
        } else {
          this.handleStaleConnection(peerId)
        }
      }
    })
  }

  // Handle a stale/failed connection
  handleStaleConnection(peerId) {
    console.log('Handling stale connection for:', peerId)

    // Close the existing connection
    const conn = this.connections.get(peerId)
    if (conn) {
      try {
        conn.close()
      } catch (e) {
        console.warn('Error closing stale connection:', e)
      }
    }
    this.connections.delete(peerId)
    this.connectionHealth.delete(peerId)

    // Notify about peer disconnection
    this.emit('peerDisconnected', peerId)

    // Attempt to reconnect if this is the host connection
    if (!this.isHost && peerId.startsWith('host-') && this.peer?.open) {
      this.attemptReconnectToHost(peerId)
    }
  }

  // Attempt to reconnect to host after disconnection
  attemptReconnectToHost(hostPeerId, retryCount = 0) {
    if (retryCount >= this.maxRetries) {
      console.error('Max reconnection attempts reached for host')
      this.emit('reconnectionFailed', hostPeerId)
      return
    }

    const delay = this.retryDelay * Math.pow(2, retryCount)
    console.log(`Attempting to reconnect to host in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`)

    setTimeout(() => {
      if (!this.peer || !this.peer.open) {
        console.log('Peer not available, skipping reconnection attempt')
        return
      }

      // Check if we're already connected now
      if (this.connections.has(hostPeerId)) {
        console.log('Already connected to host')
        return
      }

      try {
        const conn = this.peer.connect(hostPeerId, { reliable: true })
        this.setupConnectionHandlers(conn)

        const timeout = setTimeout(() => {
          console.warn('Reconnection attempt timed out')
          conn.close()
          this.attemptReconnectToHost(hostPeerId, retryCount + 1)
        }, 10000)

        conn.on('open', () => {
          clearTimeout(timeout)
          console.log('Successfully reconnected to host')
          this.handleOutgoingConnection(conn)
          this.emit('reconnected', hostPeerId)
        })

        conn.on('error', (error) => {
          clearTimeout(timeout)
          console.warn('Reconnection failed:', error)
          this.attemptReconnectToHost(hostPeerId, retryCount + 1)
        })
      } catch (error) {
        console.error('Error during reconnection attempt:', error)
        this.attemptReconnectToHost(hostPeerId, retryCount + 1)
      }
    }, delay)
  }

  handleIncomingConnection(conn) {
    console.log('Handling incoming connection from:', conn.peer)

    // Connection should already be open when this is called
    this.connections.set(conn.peer, conn)

    // Initialize connection health
    this.connectionHealth.set(conn.peer, {
      healthy: true,
      lastSeen: Date.now(),
      consecutiveFailures: 0
    })

    this.emit('peerConnected', conn.peer)

    // If we're the host, share the current connection list with new peer
    if (this.isHost) {
      this.broadcastConnectionList()

      // Help establish P2P connections between all peers
      setTimeout(() => {
        if (conn.open) {
          conn.send({
            type: 'peer_list',
            peers: Array.from(this.connections.keys()).filter(id => id !== conn.peer)
          })
        }
      }, 100) // Small delay to ensure connection is stable
    }
  }

  handleOutgoingConnection(conn) {
    console.log('Outgoing connection established with:', conn.peer, 'Connection state:', conn.open)

    // Set up handlers immediately
    this.setupConnectionHandlers(conn)

    // Add to connections
    this.connections.set(conn.peer, conn)

    // Initialize connection health
    this.connectionHealth.set(conn.peer, {
      healthy: true,
      lastSeen: Date.now(),
      consecutiveFailures: 0
    })

    this.emit('peerConnected', conn.peer)
  }

  handlePeerData(peerId, data) {
    // Prevent handling our own data (shouldn't happen but safeguard)
    if (peerId === this.peer?.id) {
      console.warn('Received data from self, ignoring')
      return
    }

    // Handle keepalive/ping messages (don't forward to game manager)
    if (data.type === 'keepalive' || data.type === 'ping') {
      // Update health when we receive keepalive
      this.updateConnectionHealth(peerId, true)

      // Respond to ping with pong
      if (data.type === 'ping') {
        const conn = this.connections.get(peerId)
        if (conn && conn.open) {
          try {
            conn.send({ type: 'pong', timestamp: Date.now() })
          } catch (error) {
            console.warn('Failed to send pong to', peerId)
          }
        }
      }
      return
    }

    // Handle pong responses
    if (data.type === 'pong') {
      this.updateConnectionHealth(peerId, true)
      // Mark as healthy again after pong response
      const health = this.connectionHealth.get(peerId)
      if (health) {
        health.healthy = true
        health.consecutiveFailures = 0
        this.connectionHealth.set(peerId, health)
      }
      return
    }

    console.log('Received data from', peerId, ':', data)

    if (data.type === 'peer_list' && !this.isHost) {
      // Connect to other peers in the session
      data.peers.forEach(peer => {
        // Prevent duplicate connections
        if (!this.connections.has(peer) && peer !== this.peer.id) {
          const conn = this.peer.connect(peer, { reliable: true })
          this.setupConnectionHandlers(conn)
          conn.on('open', () => {
            this.handleOutgoingConnection(conn)
          })
          conn.on('error', (error) => {
            console.warn('Failed to connect to peer', peer, ':', error)
          })
        }
      })
    } else {
      this.emit('dataReceived', peerId, data)
    }
  }

  broadcastConnectionList() {
    const peerList = Array.from(this.connections.keys())
    this.broadcast({
      type: 'connection_update',
      peers: peerList
    })
  }

  broadcast(data) {
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        try {
          conn.send(data)
        } catch (error) {
          console.error('Failed to send data to', peerId, ':', error)
        }
      }
    })
  }

  send(peerId, data) {
    const conn = this.connections.get(peerId)
    if (conn && conn.open) {
      try {
        conn.send(data)
      } catch (error) {
        console.error('Failed to send data to', peerId, ':', error)
      }
    }
  }

  pauseConnections() {
    console.log('Pausing peer connections due to network issues')
    // Don't close connections, just stop sending data
    // This allows for potential recovery when network returns
    this.connectionsPaused = true
  }

  resumeConnections() {
    console.log('Resuming peer connections')
    this.connectionsPaused = false
  }

  disconnect() {
    // Stop keepalive
    this.stopKeepalive()

    // Close all connections
    this.connections.forEach((conn) => {
      try {
        conn.close()
      } catch (e) {
        console.warn('Error closing connection:', e)
      }
    })
    this.connections.clear()
    this.connectionHealth.clear()

    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {
        console.warn('Error destroying peer:', e)
      }
      this.peer = null
    }
  }

  cleanupPeer() {
    // Stop keepalive
    this.stopKeepalive()

    // Clean up connections without destroying peer
    this.connections.forEach((conn) => {
      try {
        conn.close()
      } catch (e) {
        console.warn('Error closing connection:', e)
      }
    })
    this.connections.clear()
    this.connectionHealth.clear()

    // Destroy peer if it exists
    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {
        console.warn('Error destroying peer:', e)
      }
      this.peer = null
    }
  }

  createFriendlyError(error) {
    const message = error?.message || error?.type || 'Unknown error'

    // Map PeerJS error types to user-friendly messages
    if (message.includes('peer-unavailable') || message.includes('unavailable-id')) {
      return new Error('Session not found - The session may have ended, the host went offline, or the ID is incorrect. Please verify the session link with the host.')
    }

    if (message.includes('network') || message.includes('disconnected')) {
      return new Error('Network error - Your internet connection was interrupted. Please check your connection and try again. If using a corporate network, there may be firewall restrictions.')
    }

    if (message.includes('browser-incompatible')) {
      return new Error('Browser not supported - Please use a modern browser like Chrome 60+, Firefox 55+, or Safari 11+. WebRTC is required for peer-to-peer connections.')
    }

    if (message.includes('invalid-id') || message.includes('invalid-key')) {
      return new Error('Invalid session - The session ID appears to be invalid. Please check the session link and try again.')
    }

    if (message.includes('ssl-unavailable')) {
      return new Error('Secure connection required - Please make sure you\'re using HTTPS. WebRTC requires a secure context.')
    }

    if (message.includes('server-error') || message.includes('socket')) {
      return new Error('Server error - The connection service is temporarily unavailable. Please try again in a few moments.')
    }

    if (message.includes('socket-error') || message.includes('socket-closed')) {
      return new Error('Connection lost - The connection to the signaling server was lost. This can happen with unstable networks or when switching networks (e.g., WiFi to mobile). Please try refreshing the page.')
    }

    if (message.includes('timeout')) {
      return new Error('Connection timeout - Unable to establish a connection within the time limit. This may be due to slow internet, firewall restrictions, or network congestion. Please try again or check your network settings.')
    }

    // Return original error with additional context
    return new Error(`Connection failed: ${message}. Please try refreshing the page or creating a new session. If the problem persists, try using a different network or browser.`)
  }

  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(callback)
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event].forEach(callback => callback(...args))
    }
  }

  // Get connection status for a specific peer
  getConnectionStatus(peerId) {
    const conn = this.connections.get(peerId)
    const health = this.connectionHealth.get(peerId)

    if (!conn) {
      return { connected: false, healthy: false }
    }

    return {
      connected: conn.open,
      healthy: health?.healthy ?? true,
      lastSeen: health?.lastSeen ?? Date.now(),
      consecutiveFailures: health?.consecutiveFailures ?? 0
    }
  }

  // Get overall connection health status
  getConnectionHealth() {
    const now = Date.now()
    const unhealthyConnections = []
    const healthyConnections = []

    this.connectionHealth.forEach((health, peerId) => {
      if (!health.healthy || (now - health.lastSeen) > 60000) {
        unhealthyConnections.push(peerId)
      } else {
        healthyConnections.push(peerId)
      }
    })

    return {
      healthy: unhealthyConnections.length === 0,
      totalConnections: this.connections.size,
      healthyConnections: healthyConnections.length,
      unhealthyConnections: unhealthyConnections.length,
      unhealthyPeers: unhealthyConnections
    }
  }

  // Check if we have a connection to the host
  hasHostConnection() {
    if (this.isHost) return true

    for (const peerId of this.connections.keys()) {
      if (peerId.startsWith('host-')) {
        const status = this.getConnectionStatus(peerId)
        return status.connected && status.healthy
      }
    }
    return false
  }
}