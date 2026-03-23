import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root      = resolve(__dirname, '..')

// Sync version from package.json → plugin.json
const pkg    = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const plugin = JSON.parse(readFileSync(resolve(root, 'plugin.json'), 'utf8'))
plugin.version = pkg.version
writeFileSync(resolve(root, 'plugin.json'), JSON.stringify(plugin, null, 2) + '\n')
console.log(`Version synced: ${pkg.version}`)

// Run Vite build
execSync('npx vite build', { cwd: root, stdio: 'inherit' })

// Inline CSS into the JS bundle
const distDir  = resolve(root, 'dist')
const jsPath   = resolve(distDir, 'index.js')
const cssFiles = ['index.css', 'style.css'].map(f => resolve(distDir, f))
let css = ''
for (const f of cssFiles) {
    try { css += readFileSync(f, 'utf8') } catch { /* no css file */ }
}

if (css) {
    const js  = readFileSync(jsPath, 'utf8')
    const inj = `;(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();`
    writeFileSync(jsPath, inj + js)
    console.log('CSS inlined.')
}

// Copy plugin.json into dist
cpSync(resolve(root, 'plugin.json'), resolve(distDir, 'plugin.json'))

// Create zip
const zipPath = resolve(root, 'plugin.zip')
execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' })
console.log(`Built: ${zipPath}`)
