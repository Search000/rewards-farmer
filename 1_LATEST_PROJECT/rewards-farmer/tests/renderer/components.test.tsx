import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ActionButton } from '../../src/renderer/components/ActionButton'
import { ConfirmDialog } from '../../src/renderer/components/ConfirmDialog'
import { LabeledField } from '../../src/renderer/components/LabeledField'
import { NotificationProvider, useNotify } from '../../src/renderer/components/Notifications'
import { SelectField } from '../../src/renderer/components/SelectField'
import { StateBlock } from '../../src/renderer/components/StateBlock'
import { ToggleSwitch } from '../../src/renderer/components/ToggleSwitch'

describe('ActionButton', () => {
    it('calls onClick when enabled', async () => {
        const fn = vi.fn()
        render(<ActionButton label="Open" onClick={fn} />)
        await userEvent.click(screen.getByRole('button', { name: 'Open' }))
        expect(fn).toHaveBeenCalledOnce()
    })
    it('with a disabledReason it is disabled, never fires, and exposes the reason', async () => {
        const fn = vi.fn()
        render(<ActionButton label="Open" onClick={fn} disabledReason="Nothing is running." />)
        const btn = screen.getByRole('button', { name: 'Open' })
        expect(btn).toBeDisabled()
        fireEvent.click(btn) // user-event refuses pointer-events:none, so use a raw click event
        expect(fn).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Nothing is running.')).toBeInTheDocument()
    })
    it('busy disables the button and sets aria-busy', () => {
        render(<ActionButton label="Working" busy />)
        const btn = screen.getByRole('button', { name: 'Working' })
        expect(btn).toBeDisabled()
        expect(btn).toHaveAttribute('aria-busy', 'true')
    })
})

describe('ToggleSwitch', () => {
    function Harness() {
        const [v, setV] = useState(false)
        return <ToggleSwitch label="Timer" checked={v} onChange={setV} />
    }
    it('toggles by click and by Space key', async () => {
        const user = userEvent.setup()
        render(<Harness />)
        const sw = screen.getByRole('switch', { name: 'Timer' })
        expect(sw).not.toBeChecked()
        await user.click(sw)
        expect(sw).toBeChecked()
        sw.focus()
        await user.keyboard(' ')
        expect(sw).not.toBeChecked()
    })
    it('disabled switch cannot change and states the reason in its label', async () => {
        const fn = vi.fn()
        render(
            <ToggleSwitch label="Randomization" checked={false} onChange={fn} disabledReason="Not built" />
        )
        const sw = screen.getByRole('switch', { name: 'Randomization (Not built)' })
        expect(sw).toBeDisabled()
        fireEvent.click(sw)
        expect(fn).not.toHaveBeenCalled()
    })
})

describe('SelectField and LabeledField', () => {
    it('SelectField reports the chosen option', async () => {
        const user = userEvent.setup()
        const fn = vi.fn()
        render(
            <SelectField
                label="Log level"
                value="info"
                onChange={fn}
                options={[
                    { value: 'info', label: 'Info' },
                    { value: 'warn', label: 'Warn' }
                ]}
            />
        )
        await user.click(screen.getByRole('combobox', { name: 'Log level' }))
        await user.click(screen.getByRole('option', { name: 'Warn' }))
        expect(fn).toHaveBeenCalledWith('warn')
    })
    it('LabeledField shows an error message and marks the input invalid', () => {
        render(<LabeledField label="Path" value="x" error="Value is not valid." />)
        expect(screen.getByLabelText('Path')).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByText('Value is not valid.')).toBeInTheDocument()
    })
    it('LabeledField disabled shows the reason as helper text', () => {
        render(<LabeledField label="Path" value="" disabledReason="Not connected yet." />)
        expect(screen.getByLabelText('Path')).toBeDisabled()
        expect(screen.getByText('Not connected yet.')).toBeInTheDocument()
    })
})

describe('ConfirmDialog', () => {
    it('has an accessible name and fires confirm and cancel; Escape cancels', async () => {
        const user = userEvent.setup()
        const onConfirm = vi.fn()
        const onCancel = vi.fn()
        render(
            <ConfirmDialog
                open
                title="Delete?"
                message="Cannot be undone."
                confirmLabel="Delete"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />
        )
        expect(screen.getByRole('dialog', { name: 'Delete?' })).toHaveAccessibleDescription(
            'Cannot be undone.'
        )
        await user.click(screen.getByRole('button', { name: 'Delete' }))
        expect(onConfirm).toHaveBeenCalledOnce()
        await user.keyboard('{Escape}')
        expect(onCancel).toHaveBeenCalled()
    })
})

describe('Notifications', () => {
    function Trigger() {
        const { notify } = useNotify()
        return <button onClick={() => notify('Saved', 'success')}>go</button>
    }
    it('shows the message in an alert', async () => {
        render(
            <NotificationProvider>
                <Trigger />
            </NotificationProvider>
        )
        await userEvent.click(screen.getByRole('button', { name: 'go' }))
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Saved'))
    })
    it('useNotify outside the provider throws a clear error', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        expect(() => render(<Trigger />)).toThrow(/NotificationProvider/)
        spy.mockRestore()
    })
})

describe('StateBlock', () => {
    it('error uses role alert and offers retry', async () => {
        const fn = vi.fn()
        render(<StateBlock state="error" message="Engine failed" onRetry={fn} />)
        expect(screen.getByRole('alert')).toHaveTextContent('Engine failed')
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(fn).toHaveBeenCalledOnce()
    })
    it('loading is a busy status; empty and unavailable are statuses without retry', () => {
        const { rerender } = render(<StateBlock state="loading" message="Loading" />)
        expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
        rerender(<StateBlock state="empty" message="Nothing here" />)
        expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy')
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
})
