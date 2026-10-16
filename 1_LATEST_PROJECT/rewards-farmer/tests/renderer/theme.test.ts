import { describe, expect, it } from 'vitest'
import { buildTheme } from '../../src/renderer/theme'
import { darkTokens, lightTokens } from '../../src/renderer/tokens'

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
}

describe('theme tokens', () => {
    it('dark tokens equal the colors sampled from the reference screenshots', () => {
        expect(darkTokens.background).toBe('#121318')
        expect(darkTokens.card).toBe('#1c1b21')
        expect(darkTokens.appBar).toBe('#35343a')
        expect(darkTokens.primaryContainer).toBe('#394279')
        expect(darkTokens.navPill).toBe('#424558')
        expect(darkTokens.primary).toBe('#bac2ff')
    })

    it('buildTheme maps tokens into the MUI palette', () => {
        const dark = buildTheme('dark')
        expect(dark.palette.mode).toBe('dark')
        expect(dark.palette.background.default).toBe(darkTokens.background)
        expect(dark.palette.background.paper).toBe(darkTokens.card)
        expect(buildTheme('light').palette.background.default).toBe(lightTokens.background)
    })

    it.each([
        ['dark', darkTokens],
        ['light', lightTokens]
    ] as const)('%s theme: text on card and on background meets WCAG AA (4.5:1)', (_n, t) => {
        expect(contrast(t.textPrimary, t.card)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.textPrimary, t.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.textSecondary, t.card)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.textPrimary, t.primaryContainer)).toBeGreaterThanOrEqual(4.5)
    })
})
