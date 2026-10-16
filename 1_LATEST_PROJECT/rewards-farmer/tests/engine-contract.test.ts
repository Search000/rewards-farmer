import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ALLOWED_ENGINE_ROUTES, FORBIDDEN_ENGINE_PATHS, isAllowedRoute } from '../src/shared/engine-contract'

const root = join(__dirname, '..')
const contractDoc = readFileSync(join(root, 'docs', 'integration-contract.md'), 'utf8')

describe('engine contract', () => {
    it('every allowed route path is documented in docs/integration-contract.md', () => {
        for (const route of ALLOWED_ENGINE_ROUTES) {
            expect(contractDoc, `${route.method} ${route.path}`).toContain('`' + route.path)
        }
    })

    it('no forbidden path is in the allowed list', () => {
        for (const bad of FORBIDDEN_ENGINE_PATHS) {
            expect(ALLOWED_ENGINE_ROUTES.some((r) => r.path.startsWith(bad))).toBe(false)
        }
    })

    it('isAllowedRoute is strict about method and path', () => {
        expect(isAllowedRoute('POST', '/start')).toBe(true)
        expect(isAllowedRoute('GET', '/start')).toBe(false)
        expect(isAllowedRoute('GET', '/schedule')).toBe(false)
    })
})
