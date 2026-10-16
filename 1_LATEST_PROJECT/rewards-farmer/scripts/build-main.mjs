import { build } from 'esbuild'

const common = {
    bundle: true,
    platform: 'node',
    target: 'node24',
    sourcemap: true,
    external: ['electron'],
    logLevel: 'info'
}

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', format: 'cjs' })
// Sandboxed preload must be one CommonJS file that only requires 'electron'.
await build({
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload/preload.js',
    format: 'cjs'
})
