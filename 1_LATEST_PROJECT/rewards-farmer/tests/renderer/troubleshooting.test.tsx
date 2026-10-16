import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuideDialog, renderInline } from '../../src/renderer/components/GuideDialog'
import { GUIDE_SECTIONS } from '../../src/renderer/guide'
import { CHECK_DEFS } from '../../src/shared/health-rules'
import { findSection, guideIdFor } from '../../src/shared/troubleshooting-rules'
import { makeCheck } from '../../src/shared/health-rules'

describe('troubleshooting guide in the app', () => {
    it('every health row except "app" has a guide section, and "unknown" has one', () => {
        for (const d of CHECK_DEFS)
            if (d.id !== 'app') expect(findSection(GUIDE_SECTIONS, d.id), d.id).not.toBeNull()
        expect(findSection(GUIDE_SECTIONS, 'unknown')).not.toBeNull()
    })
    it('ok rows have no guide, failed rows open their own section, unknown rows open the Unknown section', () => {
        const t = '2026-10-14T10:00:00.000Z'
        expect(guideIdFor(makeCheck('node', 'ok', 'x', null, t))).toBeNull()
        expect(guideIdFor(makeCheck('node', 'error', 'x', 'y', t))).toBe('node')
        expect(guideIdFor(makeCheck('git', 'warning', 'x', 'y', t))).toBe('git')
        expect(guideIdFor(makeCheck('network', 'unknown', 'x', null, t))).toBe('unknown')
    })
    it('the dialog shows the section text from the guide file and closes', () => {
        const onClose = vi.fn()
        const section = findSection(GUIDE_SECTIONS, 'config-valid')
        render(<GuideDialog section={section} onClose={onClose} />)
        expect(screen.getByText('config.json content')).toBeTruthy()
        expect(screen.getByText('config.json is not valid JSON.')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(onClose).toHaveBeenCalled()
    })
    it('shows bold and code marks as real formatting, never as raw ** or ` characters', () => {
        const section = findSection(GUIDE_SECTIONS, 'config-file')
        render(<GuideDialog section={section} onClose={() => undefined} />)
        const text = screen.getByTestId('guide-dialog').textContent ?? ''
        expect(text).not.toContain('**')
        expect(text).not.toContain('`')
        expect(text).toContain('Create config')
        const parts = renderInline('Press **Create config** in `config.json` now')
        expect(parts).toHaveLength(5)
    })
})
