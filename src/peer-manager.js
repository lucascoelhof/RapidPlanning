// PeerJS is loaded globally from CDN
const Peer = window.Peer;

import { EventEmitter } from './utils/event-emitter.js'

export class PeerManager extends EventEmitter {
  constructor() {
    super()
    this.peer = null
    this.connections = new Map()
    this.sessionId = null
    this.isHost = false
    this.connectionState = 'disconnected' // disconnected, connecting, connected, disconnecting
    this.connectionPromise = null // Store pending connection promise
    this.messageQueue = [] // Queue for messages when offline/poor connection
    this.maxQueueSize = 100 // Maximum messages to queue
    this.connectionsPaused = false
  }

  async createSession(sessionId) {
    // Check if already connecting or connected
    if (this.connectionState === 'connecting') {
      console.log('Connection already in progress, waiting for it to complete')
      return this.connectionPromise
    }

    if (this.connectionState === 'connected' && this.peer && this.peer.open) {
      console.log('Already connected to peer network, not creating new connection')
      return Promise.resolve()
    }

    // Clean up any stale peer connection
    if (this.peer && !this.peer.open) {
      console.log('Cleaning up stale peer connection')
      await this.cleanupPeer()
    }

    this.sessionId = sessionId
    this.isHost = true
    this.connectionState = 'connecting'

    this.connectionPromise = new Promise((resolve, reject) => {
      console.log('Creating new peer connection for hosting session')

      let resolved = false

      // Try the default PeerJS cloud service first
      this.peer = new Peer(`host-${sessionId}`, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      })

      this.peer.on('open', (id) => {
        console.log('Host peer connected with ID:', id)
        this.connectionState = 'connected'
        this.emit('connected', id)
        resolved = true
        resolve()
      })

      this.peer.on('connection', (conn) => {
        console.log('Received connection request from:', conn.peer, 'Open:', conn.open)

        // Set up handlers for the connection
        this.setupConnectionHandlers(conn)

        // Handle the connection when it opens
        if (conn.open) {
          console.log('Incoming connection already open')
          this.handleIncomingConnection(conn)
        } else {
          // Wait for connection to open
          conn.on('open', () => {
            console.log('Incoming connection opened from:', conn.peer)
            this.handleIncomingConnection(conn)
          })
        }
      })

      this.peer.on('error', (error) => {
        console.error('Peer error:', error)
        if (!resolved) {
          this.connectionState = 'disconnected'
          this.cleanupPeer()
          reject(this.createFriendlyError(error))
        }
      })

      setTimeout(() => {
        if (!resolved) {
          this.connectionState = 'disconnected'
          this.cleanupPeer()
          reject(new Error('Connection timeout - Unable to connect to the peer network. Please check your internet connection and try again.'))
        }
      }, 15000) // Increased timeout to 15 seconds
    })

    return this.connectionPromise
  }

  async joinSession(sessionId) {
    // Check if already connecting or connected
    if (this.connectionState === 'connecting') {
      console.log('Connection already in progress, waiting for it to complete')
      return this.connectionPromise
    }

    if (this.connectionState === 'connected' && this.peer && this.peer.open) {
      console.log('Already connected to peer network, not creating new connection')
      return Promise.resolve()
    }

    // Clean up any stale peer connection
    if (this.peer && !this.peer.open) {
      console.log('Cleaning up stale peer connection')
      await this.cleanupPeer()
    }

    this.sessionId = sessionId
    this.isHost = false
    this.connectionState = 'connecting'

    this.connectionPromise = new Promise((resolve, reject) => {
      console.log('Creating new peer connection for joining session')

      let peerResolved = false
      let hostConnectionResolved = false

      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      })

      this.peer.on('open', (id) => {
        console.log('Client peer connected with ID:', id)
        this.emit('connected', id)
        peerResolved = true

        // Connect to host
        const hostConnection = this.peer.connect(`host-${sessionId}`, {
          reliable: true
        })

        // Check if connection is already open
        if (hostConnection.open) {
          console.log('Connection to host already open')
          this.connectionState = 'connected'
          this.handleOutgoingConnection(hostConnection)
          hostConnectionResolved = true
          resolve()
        } else {
          hostConnection.on('open', () => {
            console.log('Connected to host')
            this.connectionState = 'connected'
            this.handleOutgoingConnection(hostConnection)
            hostConnectionResolved = true
            resolve()
          })
        }

        hostConnection.on('error', (error) => {
          console.error('Connection to host failed:', error)
          if (!hostConnectionResolved) {
            this.connectionState = 'disconnected'
            this.cleanupPeer()
            reject(new Error('Failed to connect to session - The host may be offline or the session ID is invalid.'))
          }
        })

        setTimeout(() => {
          if (!hostConnectionResolved) {
            console.error('Connection timeout - host connection did not open')
            this.connectionState = 'disconnected'
            this.cleanupPeer()
            reject(new Error('Connection timeout - Unable to reach the session host. The host may be offline or the session may not exist.'))
          }
        }, 15000) // Increased timeout to 15 seconds
      })

      this.peer.on('connection', (conn) => {
        console.log('Received connection request from:', conn.peer, 'Open:', conn.open)

        // Set up handlers for the connection
        this.setupConnectionHandlers(conn)

        // Handle the connection when it opens
        if (conn.open) {
          console.log('Incoming connection already open')
          this.handleIncomingConnection(conn)
        } else {
          // Wait for connection to open
          conn.on('open', () => {
            console.log('Incoming connection opened from:', conn.peer)
            this.handleIncomingConnection(conn)
          })
        }
      })

      this.peer.on('error', (error) => {
        console.error('Peer error:', error)
        if (!peerResolved) {
          this.connectionState = 'disconnected'
          this.cleanupPeer()
          reject(this.createFriendlyError(error))
        }
      })

      // Timeout for initial peer creation
      setTimeout(() => {
        if (!peerResolved) {
          this.connectionState = 'disconnected'
          this.cleanupPeer()
          reject(new Error('Connection timeout - Unable to connect to the peer network. Please check your internet connection and try again.'))
        }
      }, 15000)
    })

    return this.connectionPromise
  }

  setupConnectionHandlers(conn) {
    // Set up data, close, and error handlers immediately
    conn.on('data', (data) => {
      console.log('Data received from', conn.peer, ':', data)
      this.handlePeerData(conn.peer, data)
    })

    conn.on('close', () => {
      console.log('Connection closed for:', conn.peer)
      this.connections.delete(conn.peer)
      this.emit('peerDisconnected', conn.peer)
    })

    conn.on('error', (error) => {
      console.error('Connection error for', conn.peer, ':', error)
      // Don't delete connection on error, let close event handle it
    })
  }

  handleIncomingConnection(conn) {
    console.log('Handling incoming connection from:', conn.peer)
    
    // Connection should already be open when this is called
    this.connections.set(conn.peer, conn)
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
    this.emit('peerConnected', conn.peer)
  }

  handlePeerData(peerId, data) {
    // Prevent handling our own data (shouldn't happen but safeguard)
    if (peerId === this.peer?.id) {
      console.warn('Received data from self, ignoring')
      return
    }
    
    console.log('Received data from', peerId, ':', data)
    
    if (data.type === 'peer_list' && !this.isHost) {
      // Connect to other peers in the session
      data.peers.forEach(peer => {
        if (!this.connections.has(peer) && peer !== this.peer.id) {
          const conn = this.peer.connect(peer)
          conn.on('open', () => {
            this.handleOutgoingConnection(conn)
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
    // If connections are paused, queue the message
    if (this.connectionsPaused || this.connectionState !== 'connected') {
      this.queueMessage({ type: 'broadcast', data })
      return
    }

    let sentSuccessfully = false
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        try {
          conn.send(data)
          sentSuccessfully = true
        } catch (error) {
          console.error('Failed to send data to', peerId, ':', error)
        }
      }
    })

    // If no messages were sent successfully, queue it
    if (!sentSuccessfully && this.connections.size > 0) {
      this.queueMessage({ type: 'broadcast', data })
    }
  }

  send(peerId, data) {
    // If connections are paused, queue the message
    if (this.connectionsPaused || this.connectionState !== 'connected') {
      this.queueMessage({ type: 'send', peerId, data })
      return
    }

    const conn = this.connections.get(peerId)
    if (conn && conn.open) {
      try {
        conn.send(data)
      } catch (error) {
        console.error('Failed to send data to', peerId, ':', error)
        // Queue the message for retry
        this.queueMessage({ type: 'send', peerId, data })
      }
    } else {
      // Connection not available, queue the message
      this.queueMessage({ type: 'send', peerId, data })
    }
  }

  queueMessage(message) {
    // Add to queue if not full
    if (this.messageQueue.length < this.maxQueueSize) {
      this.messageQueue.push({
        ...message,
        timestamp: Date.now()
      })
      console.log(`Message queued (${this.messageQueue.length}/${this.maxQueueSize})`)
    } else {
      console.warn('Message queue full, dropping oldest message')
      // Remove oldest message and add new one
      this.messageQueue.shift()
      this.messageQueue.push({
        ...message,
        timestamp: Date.now()
      })
    }
  }

  flushMessageQueue() {
    if (this.messageQueue.length === 0) return

    console.log(`Flushing ${this.messageQueue.length} queued messages`)

    // Process all queued messages
    const messages = [...this.messageQueue]
    this.messageQueue = []

    messages.forEach(message => {
      if (message.type === 'broadcast') {
        this.broadcast(message.data)
      } else if (message.type === 'send') {
        this.send(message.peerId, message.data)
      }
    })
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

    // Flush any queued messages
    this.flushMessageQueue()
  }

  disconnect() {
    this.connectionState = 'disconnecting'

    this.connections.forEach((conn) => {
      conn.close()
    })
    this.connections.clear()

    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }

    // Clear message queue on disconnect
    this.messageQueue = []
    this.connectionsPaused = false

    this.connectionState = 'disconnected'
    this.connectionPromise = null
  }

  cleanupPeer() {
    this.connectionState = 'disconnecting'

    // Clean up connections without destroying peer
    this.connections.forEach((conn) => {
      try {
        conn.close()
      } catch (e) {
        console.warn('Error closing connection:', e)
      }
    })
    this.connections.clear()

    // Destroy peer if it exists
    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {
        console.warn('Error destroying peer:', e)
      }
      this.peer = null
    }

    this.connectionState = 'disconnected'
    this.connectionPromise = null
  }

  createFriendlyError(error) {
    const message = error?.message || error?.type || 'Unknown error'

    // Map PeerJS error types to user-friendly messages
    if (message.includes('peer-unavailable') || message.includes('unavailable-id')) {
      return new Error('Session not found - The session may have ended or the ID is incorrect.')
    }

    if (message.includes('network') || message.includes('disconnected')) {
      return new Error('Network error - Please check your internet connection and try again.')
    }

    if (message.includes('browser-incompatible')) {
      return new Error('Browser not supported - Please use a modern browser like Chrome, Firefox, or Safari.')
    }

    if (message.includes('invalid-id') || message.includes('invalid-key')) {
      return new Error('Invalid session - Please check the session link and try again.')
    }

    if (message.includes('ssl-unavailable')) {
      return new Error('Secure connection required - Please make sure you\'re using HTTPS.')
    }

    // Return original error with additional context
    return new Error(`Connection failed: ${message}. Please try refreshing the page or creating a new session.`)
  }

  cleanup() {
    // Disconnect all peer connections
    this.disconnect()
    // Clean up event emitter listeners
    this.destroy()
  }
}