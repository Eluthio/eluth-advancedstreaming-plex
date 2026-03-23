import { createApp } from 'vue'
import PlexOverlay from './components/PlexOverlay.vue'

// ── Register as a stream source ───────────────────────────────────────────────
window.__EluthStreamSources = window.__EluthStreamSources || {}

window.__EluthStreamSources['plex'] = {
    label: 'Plex',
    icon:  '🎬',

    /**
     * Called by Advanced Streaming when the user picks Plex as a source.
     * Returns a Promise<MediaStream> — the captured output of a Plex HLS player.
     */
    getStream() {
        return new Promise((resolve, reject) => {
            // Mount the overlay UI onto the document body
            const el = document.createElement('div')
            el.id = 'eluth-plex-overlay-root'
            document.body.appendChild(el)

            const app = createApp(PlexOverlay)

            app.provide('onStream', (stream) => {
                app.unmount()
                el.remove()
                resolve(stream)
            })

            app.provide('onCancel', () => {
                app.unmount()
                el.remove()
                reject(new Error('cancelled'))
            })

            app.mount(el)
        })
    },
}

// ── Register the plugin itself ────────────────────────────────────────────────
window.__EluthPlugins = window.__EluthPlugins || {}
window.__EluthPlugins['advancedstreaming-plex'] = {
    zones: [],  // no UI zone — source-only plugin
}
