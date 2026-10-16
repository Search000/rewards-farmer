import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
    // Main-process tests run with `@vitest-environment node` (no window).
    if (typeof window === 'undefined') return
    cleanup()
    window.location.hash = ''
})
