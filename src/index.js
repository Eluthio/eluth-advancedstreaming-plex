import Hls from 'hls.js'
import PlexControls from './PlexControls.vue'

const CONFIG_KEY     = 'eluth_plex_config'
const PLEX_PRODUCT   = 'Eluth'
const PLEX_CLIENT_ID = 'eluth-plugin-plex'

// ── Headless player state ─────────────────────────────────────────────────────
let videoEl        = null
let hls            = null
let capturedStream = null
let stateCallback  = null

const plexState = {
    isConfigured: false,
    isPlaying:    false,
    isPaused:     false,
    currentTime:  0,
    duration:     0,
    title:        '',
    error:        null,
    savedConfig:  null,
}

// ── Config persistence ────────────────────────────────────────────────────────
function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') } catch { return null }
}

function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    plexState.savedConfig = config
}

// ── State notification ────────────────────────────────────────────────────────
function notify() {
    stateCallback?.({ ...plexState })
}

// ── Hidden video element ──────────────────────────────────────────────────────
function ensureVideoEl() {
    if (videoEl) return
    videoEl = document.createElement('video')
    videoEl.volume      = 0        // muted=true blocks captureStream audio; volume=0 keeps tracks capturable
    videoEl.playsInline = true
    Object.assign(videoEl.style, {
        position: 'absolute', width: '1px', height: '1px',
        opacity: '0', pointerEvents: 'none', top: '-9999px',
    })
    document.body.appendChild(videoEl)

    videoEl.addEventListener('timeupdate', () => {
        plexState.currentTime = videoEl.currentTime
        notify()
    })
    videoEl.addEventListener('durationchange', () => {
        plexState.duration = isFinite(videoEl.duration) ? videoEl.duration : 0
        notify()
    })
    videoEl.addEventListener('play',  () => { plexState.isPlaying = true;  plexState.isPaused = false; notify() })
    videoEl.addEventListener('pause', () => { plexState.isPaused  = true;  notify() })
    videoEl.addEventListener('ended', () => { plexState.isPlaying = false; notify() })
}

// ── Playback ──────────────────────────────────────────────────────────────────
function startPlayback(config) {
    return new Promise((resolve, reject) => {
        ensureVideoEl()
        if (hls) { hls.destroy(); hls = null }
        capturedStream = null

        const { serverUri, accessToken, ratingKey, title } = config
        const sessionId = Math.random().toString(36).slice(2)

        const params = new URLSearchParams({
            hasMDE: '1',
            path: `/library/metadata/${ratingKey}`,
            mediaIndex: '0', partIndex: '0',
            protocol: 'hls', directPlay: '0', directStream: '1',
            videoResolution: '1920x1080', maxVideoBitrate: '20000', videoQuality: '100',
            session: sessionId,
            'X-Plex-Token':              accessToken,
            'X-Plex-Product':            PLEX_PRODUCT,
            'X-Plex-Version':            '1.0.0',
            'X-Plex-Client-Identifier':  PLEX_CLIENT_ID,
            'X-Plex-Platform':           'Web',
        })

        plexState.title        = title || ''
        plexState.isConfigured = true
        plexState.isPlaying    = false
        plexState.error        = null
        notify()

        const hlsUrl = `${serverUri}/video/:/transcode/universal/start.m3u8?${params}`

        if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: false })
            hls.loadSource(hlsUrl)
            hls.attachMedia(videoEl)
            hls.once(Hls.Events.MANIFEST_PARSED, () => {
                videoEl.play().then(() => {
                    try { capturedStream = videoEl.captureStream(30); resolve(capturedStream) }
                    catch (e) { reject(e) }
                }).catch(reject)
            })
            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) { plexState.error = 'Stream error'; notify(); reject(new Error('HLS error')) }
            })
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = hlsUrl
            videoEl.addEventListener('canplay', () => {
                videoEl.play().then(() => {
                    try { capturedStream = videoEl.captureStream(30); resolve(capturedStream) }
                    catch (e) { reject(e) }
                }).catch(reject)
            }, { once: true })
        } else {
            reject(new Error('HLS not supported in this browser'))
        }
    })
}

function stopPlayback() {
    if (hls) { hls.destroy(); hls = null }
    if (videoEl) { videoEl.src = ''; videoEl.load() }
    capturedStream = null
    plexState.isPlaying   = false
    plexState.isPaused    = false
    plexState.currentTime = 0
    plexState.duration    = 0
    notify()
}

// ── Initialise from saved config ──────────────────────────────────────────────
const saved = loadConfig()
if (saved) {
    plexState.savedConfig  = saved
    plexState.isConfigured = true
    plexState.title        = saved.title || ''
}

// ── Register controls component for the stream control popup ──────────────────
window.__EluthPluginControls = window.__EluthPluginControls || {}
window.__EluthPluginControls['plex'] = PlexControls

// ── Register as stream source ─────────────────────────────────────────────────
window.__EluthStreamSources = window.__EluthStreamSources || {}
window.__EluthStreamSources['plex'] = {
    label: 'Plex',
    icon:  '🎬',
    slug:  'advancedstreaming-plex',

    // AdvancedStreaming calls this on mount so plex state changes trigger a broadcast
    setStateCallback(cb) { stateCallback = cb },

    // Exposes the raw video element so AdvancedStreaming can use createMediaElementSource
    // instead of captureStream — works around Chromium's MSE/captureStream audio omission.
    getAudioElement() { return videoEl },

    // Called when going live with a Plex layer — auto-starts with saved config, no UI
    async getStream() {
        const config = loadConfig()
        if (!config?.ratingKey) return null
        // Reuse existing stream if already playing
        if (capturedStream && videoEl && !videoEl.paused && !videoEl.ended) return capturedStream
        return startPlayback(config).catch(() => null)
    },

    // Handles plex-* control messages relayed from popup via AdvancedStreaming
    handleMessage(msg) {
        switch (msg.type) {
            case 'plex-play':
                saveConfig(msg.config)
                return startPlayback(msg.config).catch(e => { plexState.error = e.message; notify(); return null })
            case 'plex-pause':
                videoEl?.pause()
                break
            case 'plex-resume':
                videoEl?.play().catch(() => {})
                break
            case 'plex-seek':
                if (videoEl) videoEl.currentTime = msg.time
                break
            case 'plex-stop':
                stopPlayback()
                break
        }
    },

    getState() { return { ...plexState } },
}

window.__EluthPlugins = window.__EluthPlugins || {}
window.__EluthPlugins['advancedstreaming-plex'] = { zones: [] }
