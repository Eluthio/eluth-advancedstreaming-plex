<template>
    <div class="sc-plex">
        <div class="sc-plex-hdr" @click="expanded = !expanded">
            <span class="sc-plex-hdr-icon">🎬</span>
            <span class="sc-plex-hdr-label">Plex</span>
            <span v-if="state?.title && !browsing" class="sc-plex-hdr-title">{{ state.title }}</span>
            <span v-if="state?.isPlaying" class="sc-plex-hdr-live">▶</span>
            <span class="sc-plex-chevron">{{ expanded ? '▲' : '▼' }}</span>
        </div>

        <div v-if="expanded" class="sc-plex-body">

            <!-- Not authenticated -->
            <template v-if="!token">
                <div v-if="pinCode" class="sc-plex-pin-block">
                    <div class="sc-plex-pin-hint">Visit <strong>plex.tv/link</strong> and enter:</div>
                    <div class="sc-plex-pin-code">{{ pinCode }}</div>
                    <div class="sc-plex-pin-waiting">Waiting… <span class="sc-plex-spinner" /></div>
                </div>
                <button v-else class="sc-plex-action-btn" @click="startAuth" :disabled="connecting">
                    {{ connecting ? 'Opening…' : 'Connect Plex Account' }}
                </button>
            </template>

            <!-- Authenticated -->
            <template v-else>

                <!-- Transport controls -->
                <div v-if="!browsing" class="sc-plex-controls">
                    <template v-if="state?.isConfigured">
                        <div class="sc-plex-now-playing">{{ state.title || 'Ready' }}</div>
                        <div class="sc-plex-transport">
                            <button class="sc-plex-ctrl-btn"
                                @click="sendCommand({ type: state.isPlaying && !state.isPaused ? 'plex-pause' : 'plex-resume' })">
                                {{ state.isPlaying && !state.isPaused ? '⏸' : '▶' }}
                            </button>
                            <div class="sc-plex-seek-wrap">
                                <input type="range" class="sc-plex-seek"
                                    min="0" :max="Math.round(state.duration) || 100" step="1"
                                    :value="isScrubbing ? scrubPosition : Math.round(state.currentTime)"
                                    @mousedown="isScrubbing = true; scrubPosition = Math.round(state.currentTime)"
                                    @input="scrubPosition = +$event.target.value"
                                    @change="sendCommand({ type: 'plex-seek', time: +$event.target.value }); isScrubbing = false" />
                                <span class="sc-plex-time">
                                    {{ formatTime(isScrubbing ? scrubPosition : state.currentTime) }} / {{ formatTime(state.duration) }}
                                </span>
                            </div>
                            <button class="sc-plex-ctrl-btn sc-plex-ctrl-btn--stop"
                                @click="sendCommand({ type: 'plex-stop' })">⏹</button>
                        </div>
                    </template>
                    <div v-else class="sc-plex-empty-hint">No content selected.</div>
                    <div class="sc-plex-actions">
                        <button class="sc-plex-action-btn" @click="openBrowser">
                            {{ state?.isConfigured ? 'Change Content' : 'Browse Library' }}
                        </button>
                        <button class="sc-plex-disconnect" @click="disconnect">Disconnect</button>
                    </div>
                </div>

                <!-- Library browser -->
                <div v-else class="sc-plex-browser">
                    <button v-if="state?.isConfigured" class="sc-plex-back-btn" @click="browsing = false">← Back</button>

                    <!-- Server list -->
                    <div v-if="browseStep === 'servers'">
                        <div class="sc-plex-browse-title">Choose Server</div>
                        <div v-if="serversLoading" class="sc-plex-loading">Loading servers…</div>
                        <div v-else class="sc-plex-list">
                            <button v-for="s in servers" :key="s.clientIdentifier"
                                class="sc-plex-list-item" @click="selectServer(s)">
                                <span>🖥</span><span>{{ s.name }}</span>
                            </button>
                            <div v-if="!servers.length" class="sc-plex-empty">No servers found.</div>
                        </div>
                    </div>

                    <!-- Library sections -->
                    <div v-else-if="browseStep === 'sections'">
                        <button class="sc-plex-back-btn" @click="browseStep = 'servers'">← {{ activeServer?.name }}</button>
                        <div class="sc-plex-list" style="margin-top:6px">
                            <button v-for="sec in sections" :key="sec.key"
                                class="sc-plex-list-item" @click="openSection(sec)">
                                <span>{{ sectionIcon(sec.type) }}</span><span>{{ sec.title }}</span>
                            </button>
                        </div>
                    </div>

                    <!-- Items grid -->
                    <div v-else-if="browseStep === 'items'">
                        <button class="sc-plex-back-btn" @click="goBack">← Back</button>
                        <div v-if="browseTitle" class="sc-plex-browse-title">{{ browseTitle }}</div>
                        <div v-if="itemsLoading" class="sc-plex-loading">Loading…</div>
                        <div v-else class="sc-plex-grid">
                            <button v-for="item in items" :key="item.ratingKey"
                                class="sc-plex-grid-item" :title="item.title" @click="selectItem(item)">
                                <img v-if="item.thumb && activeServer"
                                    :src="`${activeServer.uri}${item.thumb}?X-Plex-Token=${activeServer.accessToken}`"
                                    class="sc-plex-thumb" loading="lazy" />
                                <span v-else class="sc-plex-thumb-ph">🎬</span>
                                <span class="sc-plex-item-label">{{ item.title }}</span>
                            </button>
                            <div v-if="!items.length" class="sc-plex-empty">No items.</div>
                        </div>
                    </div>
                </div>

            </template>
        </div>
    </div>
</template>

<script>
const PLEX_TOKEN_KEY = 'eluth_plex_token'
const PLEX_PRODUCT  = 'Eluth'
const PLEX_CLIENT_ID = 'eluth-plugin-plex'

export default {
    props: {
        state:       { type: Object,   default: null },
        sendCommand: { type: Function, required: true },
    },

    data() {
        return {
            expanded:      true,
            browsing:      false,
            token:         localStorage.getItem(PLEX_TOKEN_KEY),
            connecting:    false,
            pinCode:       null,
            pinId:         null,
            pinPoller:     null,
            browseStep:    'servers',
            servers:       [],
            serversLoading: false,
            activeServer:  null,
            sections:      [],
            items:         [],
            itemsLoading:  false,
            browseStack:   [],
            browseTitle:   '',
            isScrubbing:   false,
            scrubPosition: 0,
        }
    },

    beforeUnmount() {
        clearInterval(this.pinPoller)
    },

    methods: {
        plexHeaders(token) {
            return {
                Accept: 'application/json',
                'X-Plex-Product': PLEX_PRODUCT,
                'X-Plex-Version': '1.0.0',
                'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
                'X-Plex-Platform': 'Web',
                ...(token ? { 'X-Plex-Token': token } : {}),
            }
        },

        async startAuth() {
            this.connecting = true
            try {
                const res  = await fetch('https://plex.tv/api/v2/pins', {
                    method: 'POST', headers: this.plexHeaders(),
                })
                const data = await res.json()
                this.pinCode = data.code
                this.pinId   = data.id
                this.startPinPoller()
            } finally {
                this.connecting = false
            }
        },

        startPinPoller() {
            clearInterval(this.pinPoller)
            this.pinPoller = setInterval(async () => {
                try {
                    const res  = await fetch(`https://plex.tv/api/v2/pins/${this.pinId}`, { headers: this.plexHeaders() })
                    const data = await res.json()
                    if (data.authToken) {
                        clearInterval(this.pinPoller)
                        this.token   = data.authToken
                        this.pinCode = null
                        localStorage.setItem(PLEX_TOKEN_KEY, data.authToken)
                        await this.loadServers()
                        this.browsing = true
                    }
                } catch {}
            }, 2000)
        },

        async loadServers() {
            this.serversLoading = true
            this.browseStep = 'servers'
            try {
                const res       = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { headers: this.plexHeaders(this.token) })
                const resources = await res.json()
                this.servers = resources.filter(r => r.provides?.includes('server'))
            } catch { this.servers = [] }
            this.serversLoading = false
        },

        async openBrowser() {
            this.browsing = true
            if (!this.servers.length) await this.loadServers()
        },

        async selectServer(server) {
            const conns = server.connections ?? []
            const uri   = (conns.find(c => c.protocol === 'https' && !c.relay)
                        ?? conns.find(c => !c.relay)
                        ?? conns[0])?.uri ?? ''
            this.activeServer = { name: server.name, uri, accessToken: server.accessToken ?? this.token }
            this.browseStep = 'sections'
            try {
                const text = await this.serverFetch('/library/sections')
                this.sections = this.parsePlexXml(text, 'Directory').map(el => ({
                    key: el.getAttribute('key'), title: el.getAttribute('title'), type: el.getAttribute('type'),
                }))
            } catch { this.sections = [] }
        },

        async openSection(sec) {
            this.browseStack  = []
            this.browseTitle  = sec.title
            this.browseStep   = 'items'
            this.itemsLoading = true
            try { this.items = await this.fetchItems(`/library/sections/${sec.key}/all`) }
            catch { this.items = [] }
            this.itemsLoading = false
        },

        async drillInto(item) {
            this.browseStack.push({ title: this.browseTitle, items: this.items })
            this.browseTitle  = item.title
            this.itemsLoading = true
            try { this.items = await this.fetchItems(`/library/metadata/${item.ratingKey}/children`) }
            catch { this.items = [] }
            this.itemsLoading = false
        },

        goBack() {
            if (this.browseStack.length) {
                const prev = this.browseStack.pop()
                this.items = prev.items
                this.browseTitle = prev.title
            } else {
                this.browseStep = 'sections'
            }
        },

        async selectItem(item) {
            if (['show', 'season', 'artist', 'album'].includes(item.type)) { await this.drillInto(item); return }
            const srv = this.activeServer
            this.sendCommand({
                type:   'plex-play',
                config: { serverUri: srv.uri, accessToken: srv.accessToken, serverName: srv.name, ratingKey: item.ratingKey, title: item.title },
            })
            this.browsing = false
        },

        async serverFetch(path) {
            const srv = this.activeServer
            const res = await fetch(`${srv.uri}${path}?X-Plex-Token=${srv.accessToken}`)
            if (!res.ok) throw new Error(`Server error ${res.status}`)
            return res.text()
        },

        parsePlexXml(text, ...tags) {
            const doc = new DOMParser().parseFromString(text, 'text/xml')
            return tags.flatMap(t => [...doc.querySelectorAll(t)])
        },

        async fetchItems(path) {
            const text = await this.serverFetch(path)
            return this.parsePlexXml(text, 'Video', 'Directory')
                .filter(el => el.getAttribute('ratingKey'))
                .map(el => ({
                    ratingKey: el.getAttribute('ratingKey'),
                    title:     el.getAttribute('title'),
                    thumb:     el.getAttribute('thumb') ?? el.getAttribute('art'),
                    type:      el.getAttribute('type'),
                }))
                .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
        },

        sectionIcon(type) {
            return type === 'movie' ? '🎬' : type === 'show' ? '📺' : type === 'artist' ? '🎵' : '📁'
        },

        formatTime(secs) {
            if (!secs || !isFinite(secs)) return '0:00'
            const m = Math.floor(secs / 60), s = Math.floor(secs % 60)
            return `${m}:${String(s).padStart(2, '0')}`
        },

        disconnect() {
            localStorage.removeItem(PLEX_TOKEN_KEY)
            this.token = null
            this.servers = []
            this.activeServer = null
            this.browsing = false
            this.sendCommand({ type: 'plex-stop' })
        },
    },
}
</script>

<style>
.sc-plex { border-top: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
.sc-plex-hdr {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 14px; cursor: pointer; user-select: none;
    transition: background 0.15s;
}
.sc-plex-hdr:hover { background: rgba(255,255,255,0.04); }
.sc-plex-hdr-icon  { font-size: 14px; }
.sc-plex-hdr-label { font-size: 12px; font-weight: 700; color: #94a3b8; flex-shrink: 0; }
.sc-plex-hdr-title { font-size: 11px; color: #64748b; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sc-plex-hdr-live  { font-size: 10px; color: #4ade80; flex-shrink: 0; }
.sc-plex-chevron   { font-size: 9px; color: #475569; margin-left: auto; flex-shrink: 0; }

.sc-plex-body { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }

.sc-plex-pin-block  { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 6px 0; }
.sc-plex-pin-hint   { font-size: 12px; color: #94a3b8; text-align: center; }
.sc-plex-pin-code   { font-size: 26px; font-weight: 800; color: #e2a31a; letter-spacing: 0.15em; font-family: monospace; }
.sc-plex-pin-waiting { font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 6px; }
.sc-plex-spinner    { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.1); border-top-color: #e2a31a; border-radius: 50%; animation: plexSpin 0.8s linear infinite; }
@keyframes plexSpin { to { transform: rotate(360deg); } }

.sc-plex-action-btn {
    background: transparent; border: 1px solid rgba(255,255,255,0.15);
    color: #64748b; border-radius: 6px; padding: 6px 12px; cursor: pointer;
    font-size: 12px; width: 100%; transition: all 0.15s;
}
.sc-plex-action-btn:hover { color: #e2e8f0; background: rgba(255,255,255,0.06); }

.sc-plex-controls   { display: flex; flex-direction: column; gap: 8px; }
.sc-plex-now-playing { font-size: 13px; font-weight: 600; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-plex-transport  { display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.3); border-radius: 6px; padding: 6px 8px; }
.sc-plex-ctrl-btn   { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; border-radius: 5px; width: 28px; height: 28px; cursor: pointer; font-size: 12px; transition: all 0.15s; flex-shrink: 0; }
.sc-plex-ctrl-btn:hover { background: rgba(255,255,255,0.16); }
.sc-plex-ctrl-btn--stop { color: #f87171; }
.sc-plex-seek-wrap  { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sc-plex-seek       { width: 100%; accent-color: #e2a31a; cursor: pointer; }
.sc-plex-time       { font-size: 10px; color: #64748b; text-align: right; }
.sc-plex-empty-hint { font-size: 12px; color: #475569; }
.sc-plex-actions    { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.sc-plex-disconnect { background: none; border: none; color: #374151; font-size: 11px; cursor: pointer; padding: 0; transition: color 0.15s; }
.sc-plex-disconnect:hover { color: #64748b; }

.sc-plex-browser    { display: flex; flex-direction: column; gap: 6px; }
.sc-plex-back-btn   { background: none; border: none; color: #94a3b8; font-size: 12px; cursor: pointer; text-align: left; padding: 2px 0; }
.sc-plex-back-btn:hover { color: #e2e8f0; }
.sc-plex-browse-title { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 0 2px; }
.sc-plex-loading    { font-size: 12px; color: #475569; padding: 6px 0; }
.sc-plex-empty      { font-size: 12px; color: #374151; padding: 6px 0; }
.sc-plex-list       { display: flex; flex-direction: column; gap: 4px; }
.sc-plex-list-item  { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; color: #e2e8f0; cursor: pointer; font-size: 13px; transition: all 0.15s; text-align: left; }
.sc-plex-list-item:hover { background: rgba(255,255,255,0.08); border-color: #e2a31a; }
.sc-plex-grid       { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; }
.sc-plex-grid-item  { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; cursor: pointer; color: #cbd5e1; transition: all 0.15s; }
.sc-plex-grid-item:hover { background: rgba(255,255,255,0.1); border-color: #e2a31a; }
.sc-plex-thumb      { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 3px; }
.sc-plex-thumb-ph   { font-size: 22px; }
.sc-plex-item-label { font-size: 10px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
</style>
