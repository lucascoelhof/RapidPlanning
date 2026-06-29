// CryptoJS is loaded globally from CDN
const CryptoJS = window.CryptoJS;

export class GameManager {
  constructor() {
    this.events = {}
    this.sessionId = null
    this.localPeerId = null
    this.playerData = null
    this.players = new Map()
    this.votesRevealed = false
    this.reactionTimers = new Map() // Track reaction expiration timers
    
    this.voteCards = ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?']
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId
  }

  getLocalPlayerVote() {
    const localPlayer = this.players.get(this.localPeerId)
    return localPlayer ? localPlayer.vote : null
  }

  createSession(sessionId, playerData) {
    this.sessionId = sessionId
    this.playerData = playerData
    this.addLocalPlayer()
  }

  joinSession(sessionId) {
    this.sessionId = sessionId
    this.addLocalPlayer()
  }

  setLocalPeerId(peerId) {
    this.localPeerId = peerId
    if (this.playerData) {
      this.addLocalPlayer()
    }
  }

  setPlayerData(playerData) {
    this.playerData = playerData
    if (this.localPeerId) {
      this.addLocalPlayer()
    }
  }

  addLocalPlayer() {
    if (!this.localPeerId || !this.playerData) return
    
    // Check if local player already exists to prevent duplicates
    if (this.players.has(this.localPeerId)) {
      // Update existing player data instead of creating duplicate
      const existingPlayer = this.players.get(this.localPeerId)
      this.players.set(this.localPeerId, {
        ...existingPlayer,
        name: this.playerData.name,
        email: this.playerData.email,
        avatar: this.playerData.avatar,
        isLocal: true
      })
    } else {
      // Add new local player
      this.players.set(this.localPeerId, {
        id: this.localPeerId,
        name: this.playerData.name,
        email: this.playerData.email,
        avatar: this.playerData.avatar,
        vote: null,
        reaction: null,
        isLocal: true
      })
    }
    
    this.broadcastPlayerUpdate()
    this.emit('playersUpdated', Array.from(this.players.values()))
  }

  addPeer(peerId) {
    // Don't add ourselves as a peer
    if (peerId === this.localPeerId) return
    
    // Send our player data to the new peer
    const localPlayer = this.players.get(this.localPeerId)
    if (localPlayer) {
      this.sendToPlayer(peerId, {
        type: 'player_data',
        player: localPlayer
      })
    }
    
    // Request player data from the new peer
    this.sendToPlayer(peerId, {
      type: 'request_player_data'
    })
  }

  removePeer(peerId) {
    // Clear any reaction timer for this peer
    this.clearReactionTimer(peerId)
    
    if (this.players.has(peerId)) {
      console.log('Removing disconnected player:', peerId)
      this.players.delete(peerId)
      this.emit('playersUpdated', Array.from(this.players.values()))
      this.checkVotingComplete()
      
      // Notify other players about the disconnection
      if (this.localPeerId) {
        this.broadcast({
          type: 'player_disconnected',
          peerId: peerId
        })
      }
    }
  }

  handlePeerMessage(peerId, data) {
    switch (data.type) {
      case 'player_data':
        // Only add the player if it's not our local player
        if (peerId !== this.localPeerId) {
          this.players.set(peerId, {
            ...data.player,
            id: peerId,
            isLocal: false
          })
          this.emit('playersUpdated', Array.from(this.players.values()))
        }
        break
        
      case 'request_player_data':
        if (this.players.has(this.localPeerId)) {
          this.sendToPlayer(peerId, {
            type: 'player_data',
            player: this.players.get(this.localPeerId)
          })
        }
        break
        
      case 'player_disconnected':
        // Remove the disconnected player from our list
        if (this.players.has(data.peerId)) {
          console.log('Player disconnected:', data.peerId)
          this.players.delete(data.peerId)
          this.emit('playersUpdated', Array.from(this.players.values()))
          this.checkVotingComplete()
        }
        break
        
      case 'vote':
        const player = this.players.get(peerId)
        if (player) {
          player.vote = data.vote
          this.players.set(peerId, player)
          this.emit('playersUpdated', Array.from(this.players.values()))
          this.checkVotingComplete()
        }
        break
        
      case 'clear_votes':
        this.clearVotes(false) // Don't broadcast, we received it
        break
        
      case 'show_votes':
        // Sync any missing vote data
        if (data.allVotes) {
          for (const [peerId, voteData] of Object.entries(data.allVotes)) {
            if (this.players.has(peerId)) {
              const player = this.players.get(peerId)
              player.vote = voteData.vote
              this.players.set(peerId, player)
            } else {
              // Create missing player entry
              this.players.set(peerId, {
                id: peerId,
                name: voteData.name,
                vote: voteData.vote,
                isLocal: false
              })
            }
          }
        }
        
        this.showVotes(false) // Don't broadcast, we received it
        break
        
      case 'reaction':
        const reactionPlayer = this.players.get(peerId)
        if (reactionPlayer) {
          // Clear any existing reaction timer for this peer
          this.clearReactionTimer(peerId)
          
          // Update the reaction
          reactionPlayer.reaction = data.reaction
          this.players.set(peerId, reactionPlayer)
          
          // Set expiration timer if reaction was added
          if (data.reaction && data.timestamp) {
            // Calculate remaining time based on when the reaction was sent
            const elapsed = Date.now() - data.timestamp
            const remaining = Math.max(5000 - elapsed, 100) // At least 100ms
            
            const timer = setTimeout(() => {
              this.expireReaction(peerId, data.reaction)
            }, remaining)
            
            this.reactionTimers.set(peerId, timer)
          }
          
          this.emit('playersUpdated', Array.from(this.players.values()))
        }
        break
    }
  }

  castVote(vote) {
    const localPlayer = this.players.get(this.localPeerId)
    if (localPlayer) {
      localPlayer.vote = vote
      this.players.set(this.localPeerId, localPlayer)
      
      // Broadcast vote to all peers
      this.broadcast({
        type: 'vote',
        vote: vote
      })
      
      this.emit('playersUpdated', Array.from(this.players.values()))
      this.checkVotingComplete()
    }
  }

  clearVotes(shouldBroadcast = true) {
    this.votesRevealed = false
    
    for (const [peerId, player] of this.players) {
      player.vote = null
      this.players.set(peerId, player)
    }
    
    if (shouldBroadcast) {
      this.broadcast({
        type: 'clear_votes'
      })
    }
    
    this.emit('playersUpdated', Array.from(this.players.values()))
  }

  showVotes(shouldBroadcast = true) {
    this.votesRevealed = true
    
    if (shouldBroadcast) {
      // Include all player vote data to ensure synchronization
      const allVotes = {}
      for (const [peerId, player] of this.players) {
        if (player.vote) {
          allVotes[peerId] = {
            name: player.name,
            vote: player.vote
          }
        }
      }
      
      
      this.broadcast({
        type: 'show_votes',
        allVotes: allVotes
      })
    }
    
    this.emit('playersUpdated', Array.from(this.players.values()))
    this.emit('votingComplete')
  }

  setReaction(reaction) {
    const localPlayer = this.players.get(this.localPeerId)
    if (localPlayer) {
      // Clear any existing reaction timer for this player
      this.clearReactionTimer(this.localPeerId)
      
      // Clear reaction if same emoji is clicked, otherwise set new reaction
      const newReaction = localPlayer.reaction === reaction ? null : reaction
      localPlayer.reaction = newReaction
      this.players.set(this.localPeerId, localPlayer)
      
      // Set expiration timer if reaction was added
      if (newReaction) {
        this.setReactionTimer(this.localPeerId, newReaction)
      }
      
      // Broadcast reaction to all peers
      this.broadcast({
        type: 'reaction',
        reaction: newReaction,
        timestamp: Date.now()
      })
      
      this.emit('playersUpdated', Array.from(this.players.values()))
    }
  }

  setReactionTimer(peerId, reaction) {
    const timer = setTimeout(() => {
      this.expireReaction(peerId, reaction)
    }, 5000) // 5 seconds
    
    this.reactionTimers.set(peerId, timer)
  }

  clearReactionTimer(peerId) {
    const timer = this.reactionTimers.get(peerId)
    if (timer) {
      clearTimeout(timer)
      this.reactionTimers.delete(peerId)
    }
  }

  expireReaction(peerId, expectedReaction) {
    const player = this.players.get(peerId)
    if (player && player.reaction === expectedReaction) {
      player.reaction = null
      this.players.set(peerId, player)
      
      // Clear the timer
      this.reactionTimers.delete(peerId)
      
      // Broadcast expiration if it's our own reaction
      if (peerId === this.localPeerId) {
        this.broadcast({
          type: 'reaction',
          reaction: null,
          timestamp: Date.now()
        })
        
        // Notify UI to clear reaction selection
        this.emit('reactionExpired')
      }
      
      this.emit('playersUpdated', Array.from(this.players.values()))
    }
  }

  checkVotingComplete() {
    if (this.votesRevealed) return
    
    const playersWithVotes = Array.from(this.players.values()).filter(p => p.vote !== null)
    const totalPlayers = this.players.size
    
    if (totalPlayers > 0 && playersWithVotes.length === totalPlayers) {
      setTimeout(() => {
        this.showVotes()
        this.emit('votingComplete')
      }, 500) // Small delay for better UX
    }
  }

  broadcastPlayerUpdate() {
    const localPlayer = this.players.get(this.localPeerId)
    if (localPlayer) {
      this.broadcast({
        type: 'player_data',
        player: localPlayer
      })
    }
  }

  broadcast(data) {
    // This will be called by the app to forward to peer manager
    this.emit('broadcast', data)
  }

  sendToPlayer(peerId, data) {
    // This will be called by the app to forward to peer manager
    this.emit('sendToPlayer', peerId, data)
  }

  getVoteCards() {
    return this.voteCards
  }

  isVotingComplete() {
    const playersWithVotes = Array.from(this.players.values()).filter(p => p.vote !== null)
    return this.players.size > 0 && playersWithVotes.length === this.players.size
  }

  getVotingSummary() {
    const votes = Array.from(this.players.values())
      .filter(p => p.vote !== null)
      .map(p => p.vote)
    
    const voteCount = {}
    votes.forEach(vote => {
      voteCount[vote] = (voteCount[vote] || 0) + 1
    })
    
    const consensus = this.detectConsensus(votes)
    
    return {
      votes: voteCount,
      total: votes.length,
      average: this.calculateAverage(votes),
      consensus: consensus
    }
  }

  detectConsensus(votes) {
    if (votes.length < 2) {
      return { type: 'insufficient', message: 'Need more votes' }
    }

    // Perfect consensus - everyone voted the same
    const uniqueVotes = [...new Set(votes)]
    if (uniqueVotes.length === 1) {
      return { 
        type: 'perfect', 
        message: `Perfect consensus on ${uniqueVotes[0]}!`,
        highlight: true
      }
    }

    // Check numeric consensus (within 1 point for Fibonacci-like scales)
    const numericVotes = votes
      .filter(v => !isNaN(parseFloat(v.replace('½', '.5'))))
      .map(v => parseFloat(v.replace('½', '.5')))
      .sort((a, b) => a - b)
    
    if (numericVotes.length >= votes.length * 0.8) { // At least 80% numeric votes
      const min = numericVotes[0]
      const max = numericVotes[numericVotes.length - 1]
      const range = max - min
      
      if (range === 0) {
        return { 
          type: 'perfect', 
          message: `Perfect consensus on ${min}!`,
          highlight: true
        }
      } else if (range <= 2) {
        return { 
          type: 'close', 
          message: `Close consensus (range: ${range})`,
          highlight: false
        }
      } else if (range >= 10) {
        return { 
          type: 'divergent', 
          message: `Wide range of estimates (${min}-${max})`,
          highlight: false
        }
      }
    }

    // Check if most votes are the same (majority consensus)
    const voteCount = {}
    votes.forEach(vote => {
      voteCount[vote] = (voteCount[vote] || 0) + 1
    })
    
    const maxCount = Math.max(...Object.values(voteCount))
    const maxVote = Object.keys(voteCount).find(vote => voteCount[vote] === maxCount)
    
    if (maxCount > votes.length * 0.6) { // More than 60% voted the same
      return { 
        type: 'majority', 
        message: `Majority consensus on ${maxVote} (${maxCount}/${votes.length})`,
        highlight: false
      }
    }

    return { 
      type: 'none', 
      message: 'No consensus - discussion needed',
      highlight: false
    }
  }

  calculateAverage(votes) {
    const numericVotes = votes.filter(v => !isNaN(parseFloat(v.replace('½', '.5'))))
    if (numericVotes.length === 0) return null
    
    const sum = numericVotes.reduce((acc, vote) => {
      return acc + parseFloat(vote.replace('½', '.5'))
    }, 0)
    
    return (sum / numericVotes.length).toFixed(1)
  }

  reset() {
    this.sessionId = null
    this.localPeerId = null
    this.playerData = null
    this.players.clear()
    this.votesRevealed = false
    
    // Clear all reaction timers
    for (const timer of this.reactionTimers.values()) {
      clearTimeout(timer)
    }
    this.reactionTimers.clear()
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
}