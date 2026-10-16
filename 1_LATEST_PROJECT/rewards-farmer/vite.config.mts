import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// Strict CSP injected into the production build only (Vite dev needs inline scripts and a websocket).
// 'unsafe-inline' for styles is required by Emotion (MUI). Scripts stay 'self' only.
const CSP =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

function cspPlugin(): Plugin {
    return {
        name: 'rf-csp-meta',
        apply: 'build',
        transformIndexHtml: (html) =>
            html.replace(
                '<head>',
                `<head>\n        <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
            )
    }
}

export default defineConfig({
    root: 'src/renderer',
    base: './',
    plugins: [react(), cspPlugin()],
    build: { outDir: '../../dist/renderer', emptyOutDir: true, sourcemap: true },
    server: { host: '127.0.0.1', port: 5173, strictPort: true }
})
