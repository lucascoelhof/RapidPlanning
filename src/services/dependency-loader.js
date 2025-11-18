// Dependency Loader for managing CDN dependencies with fallback support
export class DependencyLoader {
  constructor() {
    this.dependencies = {
      peerjs: {
        name: 'Peer',
        loaded: false,
        sources: [
          'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js',
          'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js'
        ]
      },
      cryptojs: {
        name: 'CryptoJS',
        loaded: false,
        sources: [
          'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js',
          'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js'
        ]
      }
    }
    this.loadTimeout = 10000 // 10 seconds timeout for each attempt
  }

  async loadAll() {
    try {
      await Promise.all([
        this.loadDependency('peerjs'),
        this.loadDependency('cryptojs')
      ])
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        missingDependencies: this.getMissingDependencies()
      }
    }
  }

  async loadDependency(key) {
    const dep = this.dependencies[key]

    // Check if already loaded
    if (window[dep.name]) {
      dep.loaded = true
      console.log(`${dep.name} already loaded`)
      return
    }

    // Try each source in order
    for (let i = 0; i < dep.sources.length; i++) {
      const source = dep.sources[i]
      try {
        console.log(`Loading ${dep.name} from ${source} (attempt ${i + 1}/${dep.sources.length})`)
        await this.loadScript(source, dep.name)
        dep.loaded = true
        console.log(`${dep.name} loaded successfully from ${source}`)
        return
      } catch (error) {
        console.warn(`Failed to load ${dep.name} from ${source}:`, error.message)
        if (i === dep.sources.length - 1) {
          // Last attempt failed
          throw new Error(`Failed to load ${dep.name} from all sources`)
        }
        // Try next source
      }
    }
  }

  loadScript(src, globalName) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.async = true

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout loading script from ${src}`))
      }, this.loadTimeout)

      const cleanup = () => {
        clearTimeout(timeout)
        script.onload = null
        script.onerror = null
      }

      script.onload = () => {
        cleanup()
        // Verify the global is actually available
        if (window[globalName]) {
          resolve()
        } else {
          reject(new Error(`Script loaded but ${globalName} is not available`))
        }
      }

      script.onerror = () => {
        cleanup()
        reject(new Error(`Network error loading ${src}`))
      }

      document.head.appendChild(script)
    })
  }

  getMissingDependencies() {
    return Object.entries(this.dependencies)
      .filter(([_, dep]) => !dep.loaded && !window[dep.name])
      .map(([key, dep]) => dep.name)
  }

  areAllDependenciesLoaded() {
    return Object.values(this.dependencies).every(dep => dep.loaded || window[dep.name])
  }
}
