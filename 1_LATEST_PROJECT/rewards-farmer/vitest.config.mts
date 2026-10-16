import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        // Tests only: the engine's real zod schema, so the app limits are checked against the real validator.
        alias: { '@engine-validator': resolve(__dirname, 'engine/src/util/Validator.ts') }
    },
    test: {
        include: ['tests/**/*.test.{ts,tsx}'],
        environment: 'jsdom',
        setupFiles: ['tests/setup.ts'],
        css: false,
        // Main-process integration tests start a real engine API process; allow time for slow machines.
        testTimeout: 60000,
        hookTimeout: 60000
    }
})
