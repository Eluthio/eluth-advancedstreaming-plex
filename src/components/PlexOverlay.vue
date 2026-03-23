<template>
    <div class="px-backdrop" @click.self="cancel">
        <div class="px-modal">

            <!-- Header -->
            <div class="px-header">
                <span class="px-logo">🎬 Plex</span>
                <button class="px-close" @click="cancel">✕</button>
            </div>

            <!-- Step: PIN auth -->
            <div v-if="step === 'auth'" class="px-step">
                <div v-if="savedToken" class="px-connected-block">
                    <div class="px-connected-label">✓ Connected to Plex</div>
                    <button class="px-btn px-btn--primary" @click="useStoredToken">Browse Library</button>
                    <button class="px-btn px-btn--sm" @click="disconnectPlex">Disconnect</button>
                </div>
                <template v-else>
                    <div class="px-auth-hint">Sign in to Plex to browse your library.</div>
                    <div v-if="pinCode" class="px-pin-block">
                        <div class="px-pin-label">Visit <strong>plex.tv/link</strong> and enter:</div>
                        <div class="px-pin-code">{{ pinCode }}</div>
                        <div class="px-pin-waiting">Waiting for authorisation…</div>
                        <div class="px-pin-spinner" />
                    </div>
                    <button v-else class="px-btn" @click="requestPin" :disabled="pinLoading">
                        {{ pinLoading ? 'Loading…' : 'Connect Plex Account' }}
                    </button>
                </template>
                <div v-if="authError" class="px-error">{{ authError }}</div>
            </div>

            <!-- Step: server picker -->
            <div v-else-if="step === 'servers'" class="px-step">
                <div class="px-step-title">Choose a Plex server</div>
                <div v-if="serversLoading" class="px-loading">Loading servers…</div>
                <div v-else-if="servers.length === 0" class="px-empty">No servers found.</div>
                <div v-else class="px-list">
                    <button
                        v-for="s in servers"
                        :key="s.clientIdentifier"
                        class="px-list-item"
                        @click="selectServer(s)"
                    >
                        <span class="px-list-icon">🖥</span>
                        <span class="px-list-name">{{ s.name }}</span>
                        <span class="px-list-meta">{{ s.connections?.[0]?.uri ?? '' }}</span>
                    </button>
                </div>
                <div v-if="serverError" class="px-error">{{ serverError }}</div>
            </div>

            <!-- Step: library browser -->
            <div v-else-if="step === 'library'" class="px-step">
                <div class="px-breadcrumb">
                    <button class="px-breadcrumb-btn" @click="step = 'servers'">← Servers</button>
                    <span v-if="activeSection"> / {{ activeSection.title }}</span>
                </div>

                <!-- Section tabs -->
                <div v-if="!activeSection" class="px-sections">
                    <div class="px-step-title">Libraries</div>
                    <div v-if="sectionsLoading" class="px-loading">Loading libraries…</div>
                    <div v-else class="px-list">
                        <button
                            v-for="sec in sections"
                            :key="sec.key"
                            class="px-list-item"
                            @click="openSection(sec)"
                        >
                            <span class="px-list-icon">{{ sectionIcon(sec.type) }}</span>
                            <span class="px-list-name">{{ sec.title }}</span>
                        </button>
                    </div>
                </div>

                <!-- Section items -->
                <div v-else>
                    <div v-if="itemsLoading" class="px-loading">Loading…</div>
                    <div v-else-if="sectionItems.length === 0" class="px-empty">No items found.</div>
                    <div v-else class="px-grid">
                        <button
                            v-for="item in sectionItems"
                            :key="item.ratingKey"
                            class="px-grid-item"
                            :title="item.title"
                            @click="selectItem(item)"
                        >
                            <img
                                v-if="item.thumb"
                                :src="thumbUrl(item.thumb)"
                                class="px-thumb"
                                loading="lazy"
                            />
                            <span v-else class="px-thumb-placeholder">🎬</span>
                            <span class="px-grid-label">{{ item.title }}</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Step: playing / capturing -->
            <div v-else-if="step === 'playing'" class="px-step px-step--playing">
                <div class="px-step-title">{{ playingTitle }}</div>
                <video ref="videoEl" class="px-video" autoplay muted playsinline />
                <div v-if="playError" class="px-error">{{ playError }}</div>
                <div v-else-if="!streamReady" class="px-loading">Buffering…</div>
                <button v-if="streamReady" class="px-btn px-btn--primary" @click="confirmStream">
                    ✓ Use as Source
                </button>
                <button class="px-btn" @click="step = 'library'">← Back</button>
            </div>

        </div>
    </div>
</template>

<script setup>
import { ref, inject, onUnmounted } from 'vue'
import Hls from 'hls.js'

const onStream = inject('onStream')
const onCancel = inject('onCancel')

const PLEX_PRODUCT    = 'Eluth'
const PLEX_CLIENT_ID  = 'eluth-plugin-plex'
const STORAGE_KEY     = 'eluth_plex_token'

// ── State ─────────────────────────────────────────────────────────────────────
const step      = ref('auth')
const authToken = ref(null)
const savedToken = ref(localStorage.getItem(STORAGE_KEY))

// Auth
const pinCode    = ref(null)
const pinId      = ref(null)
const pinLoading = ref(false)
const authError  = ref(null)
let pinPoller    = null

// Servers
const servers        = ref([])
const serversLoading = ref(false)
const serverError    = ref(null)
const activeServer   = ref(null)   // { name, uri, accessToken }

// Library
const sections        = ref([])
const sectionsLoading = ref(false)
const activeSection   = ref(null)
const sectionItems    = ref([])
const itemsLoading    = ref(false)

// Playback
const videoEl     = ref(null)
const playingTitle = ref('')
const playError   = ref(null)
const streamReady = ref(false)
let   hls         = null
let   capturedStream = null

// ── Auth: PIN flow ─────────────────────────────────────────────────────────────
async function requestPin() {
    pinLoading.value = true
    authError.value  = null
    try {
        const res = await fetch('https://plex.tv/api/v2/pins', {
            method: 'POST',
            headers: plexHeaders(),
            body: new URLSearchParams({ strong: 'false' }),
        })
        if (!res.ok) throw new Error('Failed to get PIN')
        const data = await res.json()
        pinCode.value = data.code
        pinId.value   = data.id
        startPinPoller()
    } catch (e) {
        authError.value = e.message
    } finally {
        pinLoading.value = false
    }
}

function startPinPoller() {
    clearInterval(pinPoller)
    pinPoller = setInterval(async () => {
        try {
            const res = await fetch(`https://plex.tv/api/v2/pins/${pinId.value}`, {
                headers: plexHeaders(),
            })
            if (!res.ok) return
            const data = await res.json()
            if (data.authToken) {
                clearInterval(pinPoller)
                authToken.value = data.authToken
                localStorage.setItem(STORAGE_KEY, data.authToken)
                savedToken.value = data.authToken
                pinCode.value    = null
                await loadServers()
            }
        } catch { /* network hiccup */ }
    }, 2000)
}

function useStoredToken() {
    authToken.value = savedToken.value
    loadServers()
}

function disconnectPlex() {
    localStorage.removeItem(STORAGE_KEY)
    savedToken.value = null
    authToken.value  = null
}

// ── Servers ───────────────────────────────────────────────────────────────────
async function loadServers() {
    step.value           = 'servers'
    serversLoading.value = true
    serverError.value    = null
    try {
        const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
            headers: plexHeaders(authToken.value),
        })
        if (!res.ok) throw new Error('Failed to load servers')
        const resources = await res.json()
        servers.value = resources.filter(r => r.provides?.includes('server'))
    } catch (e) {
        serverError.value = e.message
    } finally {
        serversLoading.value = false
    }
}

async function selectServer(server) {
    // Pick the best connection URI (prefer https, relay as fallback)
    const conns = server.connections ?? []
    const uri   = (conns.find(c => c.protocol === 'https' && !c.relay)
               ?? conns.find(c => !c.relay)
               ?? conns[0])?.uri ?? ''

    activeServer.value = {
        name:        server.name,
        uri:         uri,
        accessToken: server.accessToken ?? authToken.value,
    }

    step.value           = 'library'
    sectionsLoading.value = true
    activeSection.value  = null
    sectionItems.value   = []
    try {
        const res = await serverFetch('/library/sections')
        const xml  = parseXml(res)
        sections.value = xmlDirectories(xml)
    } catch (e) {
        sections.value = []
    } finally {
        sectionsLoading.value = false
    }
}

// ── Library browser ───────────────────────────────────────────────────────────
async function openSection(sec) {
    activeSection.value = sec
    itemsLoading.value  = true
    sectionItems.value  = []
    try {
        const res = await serverFetch(`/library/sections/${sec.key}/all`)
        const xml  = parseXml(res)
        sectionItems.value = xmlVideos(xml)
    } catch {
        sectionItems.value = []
    } finally {
        itemsLoading.value = false
    }
}

function sectionIcon(type) {
    return type === 'movie' ? '🎬' : type === 'show' ? '📺' : type === 'artist' ? '🎵' : '📁'
}

function thumbUrl(path) {
    const srv = activeServer.value
    return `${srv.uri}${path}?X-Plex-Token=${srv.accessToken}`
}

// ── Playback ──────────────────────────────────────────────────────────────────
async function selectItem(item) {
    // For shows, we'd normally list episodes — for simplicity, pick first episode
    // For movies & episodes, get playback session
    playingTitle.value = item.title
    playError.value    = null
    streamReady.value  = false
    step.value         = 'playing'

    // Give DOM time to mount the video element
    await new Promise(r => setTimeout(r, 50))

    try {
        await startPlayback(item)
    } catch (e) {
        playError.value = `Playback failed: ${e.message}`
    }
}

async function startPlayback(item) {
    const srv = activeServer.value

    // Request a universal transcode session — this gives us an HLS manifest
    const params = new URLSearchParams({
        'X-Plex-Token':        srv.accessToken,
        'path':                `/library/metadata/${item.ratingKey}`,
        'mediaIndex':          '0',
        'partIndex':           '0',
        'protocol':            'hls',
        'videoResolution':     '1280x720',
        'videoBitrate':        '4000',
        'audioBoost':          '100',
        'copyts':              '1',
        'subtitles':           'burn',
        'X-Plex-Platform':     'Chrome',
        'X-Plex-Product':      PLEX_PRODUCT,
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
    })

    const manifestUrl = `${srv.uri}/video/:/transcode/universal/start.m3u8?${params}`

    if (Hls.isSupported()) {
        hls = new Hls({ xhrSetup(xhr) {
            xhr.setRequestHeader('X-Plex-Token', srv.accessToken)
        }})
        hls.loadSource(manifestUrl)
        hls.attachMedia(videoEl.value)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoEl.value.play().catch(() => {})
        })
        hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) {
                playError.value = 'Stream error — check the Plex server is reachable.'
            }
        })
    } else if (videoEl.value.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        videoEl.value.src = manifestUrl
        videoEl.value.play().catch(() => {})
    } else {
        throw new Error('HLS not supported in this browser.')
    }

    videoEl.value.addEventListener('playing', () => { streamReady.value = true }, { once: true })
}

function confirmStream() {
    if (!videoEl.value) return
    try {
        capturedStream = videoEl.value.captureStream(30)
        onStream(capturedStream)
    } catch (e) {
        playError.value = 'Could not capture stream: ' + e.message
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function plexHeaders(token) {
    const h = {
        'Accept':                    'application/json',
        'X-Plex-Product':            PLEX_PRODUCT,
        'X-Plex-Version':            '1.0.0',
        'X-Plex-Client-Identifier':  PLEX_CLIENT_ID,
        'X-Plex-Platform':           'Web',
    }
    if (token) h['X-Plex-Token'] = token
    return h
}

async function serverFetch(path) {
    const srv = activeServer.value
    const res = await fetch(`${srv.uri}${path}?X-Plex-Token=${srv.accessToken}`)
    if (!res.ok) throw new Error(`Server error ${res.status}`)
    return res.text()
}

function parseXml(text) {
    return new DOMParser().parseFromString(text, 'text/xml')
}

function xmlDirectories(doc) {
    return Array.from(doc.querySelectorAll('Directory')).map(el => ({
        key:   el.getAttribute('key'),
        title: el.getAttribute('title'),
        type:  el.getAttribute('type'),
    }))
}

function xmlVideos(doc) {
    return Array.from(doc.querySelectorAll('Video')).map(el => ({
        ratingKey: el.getAttribute('ratingKey'),
        title:     el.getAttribute('title'),
        thumb:     el.getAttribute('thumb'),
        type:      el.getAttribute('type'),
        year:      el.getAttribute('year'),
    }))
}

function cancel() {
    cleanup()
    onCancel()
}

function cleanup() {
    clearInterval(pinPoller)
    if (hls) { hls.destroy(); hls = null }
    if (videoEl.value) { videoEl.value.src = ''; videoEl.value.load() }
}

onUnmounted(cleanup)
</script>

<style scoped>
.px-backdrop {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
}
.px-modal {
    background: #1a1d27; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
    width: min(560px, 96vw); max-height: 82vh;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,0.6);
}
.px-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
}
.px-logo { font-size: 16px; font-weight: 700; color: #e2a31a; }
.px-close {
    background: none; border: none; color: #64748b; font-size: 18px;
    cursor: pointer; line-height: 1; padding: 2px 6px; border-radius: 4px;
}
.px-close:hover { color: #e2e8f0; background: rgba(255,255,255,0.08); }

.px-step { padding: 20px; overflow-y: auto; flex: 1; }
.px-step--playing { display: flex; flex-direction: column; gap: 12px; }
.px-step-title { font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }

.px-auth-hint { color: #94a3b8; font-size: 14px; margin-bottom: 16px; }
.px-pin-block { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 0; }
.px-pin-label { color: #94a3b8; font-size: 14px; }
.px-pin-code { font-size: 36px; font-weight: 800; letter-spacing: 0.2em; color: #e2a31a; font-family: monospace; }
.px-pin-waiting { font-size: 13px; color: #64748b; }
.px-pin-spinner { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.1); border-top-color: #e2a31a; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.px-connected-block { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; }
.px-connected-label { font-size: 15px; font-weight: 600; color: #4ade80; }
.px-btn--sm { font-size: 12px; padding: 6px 14px; }

.px-btn {
    padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0;
    transition: all 0.15s; width: 100%;
}
.px-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
.px-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.px-btn--primary { background: #e2a31a; border-color: #e2a31a; color: #000; }
.px-btn--primary:hover:not(:disabled) { background: #f0b630; }

.px-list { display: flex; flex-direction: column; gap: 6px; }
.px-list-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
    color: #e2e8f0; text-align: left; transition: all 0.15s;
}
.px-list-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.15); }
.px-list-icon { font-size: 18px; flex-shrink: 0; }
.px-list-name { font-size: 14px; font-weight: 500; flex: 1; }
.px-list-meta { font-size: 11px; color: #64748b; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.px-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.px-grid-item {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 8px; border-radius: 8px; cursor: pointer;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
    color: #e2e8f0; transition: all 0.15s;
}
.px-grid-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.15); }
.px-thumb { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 4px; }
.px-thumb-placeholder { font-size: 40px; }
.px-grid-label { font-size: 11px; text-align: center; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }

.px-video { width: 100%; max-height: 280px; background: #000; border-radius: 6px; }

.px-breadcrumb { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 13px; color: #64748b; }
.px-breadcrumb-btn { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 13px; padding: 0; }
.px-breadcrumb-btn:hover { color: #e2e8f0; }

.px-loading { color: #64748b; font-size: 14px; padding: 20px 0; text-align: center; }
.px-empty   { color: #64748b; font-size: 14px; padding: 20px 0; text-align: center; }
.px-error   { color: #f87171; font-size: 13px; margin-top: 8px; }
</style>
