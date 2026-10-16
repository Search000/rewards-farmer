import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/App'
import { parseRoute, ROUTES, routeHash } from '../../src/renderer/routes'
import { APP_NAME } from '../../src/shared/app-info'
import { IPC } from '../../src/shared/ipc-types'

describe('routes', () => {
    it('sidebar: screenshot 1 order, with Telegram + Discord replaced by Secrets & API keys, plus Notifications, Logs, Health and Backups (not in the screenshots)', () => {
        expect(ROUTES.filter((r) => r.inSidebar).map((r) => r.label)).toEqual([
            'Home',
            'Accounts',
            'Parallel farming',
            'Secrets & API keys',
            'Notifications',
            'Logs',
            'Health',
            'Backups',
            'Settings',
            'About'
        ])
    })
    it('old Telegram and Discord hashes open the Secrets & API keys page; no such routes exist any more', () => {
        expect(parseRoute('#/telegram')).toBe('secrets')
        expect(parseRoute('#/discord')).toBe('secrets')
        expect(ROUTES.map((r) => r.id)).not.toContain('telegram')
        expect(ROUTES.map((r) => r.id)).not.toContain('discord')
    })
    it('unknown hash falls back to home, known hash round-trips', () => {
        expect(parseRoute('#/nope')).toBe('home')
        for (const r of ROUTES) expect(parseRoute(routeHash(r.id))).toBe(r.id)
    })
    it('IPC channel names are unique', () => {
        const names = Object.values(IPC)
        expect(new Set(names).size).toBe(names.length)
    })
})

describe('app shell', () => {
    it('shows the app name and the sidebar with Home selected', () => {
        render(<App />)
        expect(screen.getByText(APP_NAME)).toBeInTheDocument()
        const nav = screen.getByRole('navigation', { name: 'Main navigation' })
        expect(within(nav).getAllByRole('button')).toHaveLength(10)
        expect(within(nav).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    })

    it('every sidebar item navigates and updates the selected state and heading', async () => {
        const user = userEvent.setup()
        render(<App />)
        const nav = screen.getByRole('navigation', { name: 'Main navigation' })
        for (const r of ROUTES.filter((x) => x.inSidebar)) {
            await user.click(within(nav).getByRole('button', { name: r.label }))
            expect(within(nav).getByRole('button', { name: r.label })).toHaveAttribute('aria-current', 'page')
            // Home is the "Farmer" card of screenshot 1; every other page uses its sidebar label.
            const heading = r.id === 'home' ? 'Farmer' : r.label
            expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
        }
    })

    it('placeholder pages show only the truthful development state, no data', async () => {
        const user = userEvent.setup()
        render(<App />)
        // Settings is a real page since Phase 8, so a page with no phase yet stands in here.
        await user.click(screen.getByRole('button', { name: 'Parallel farming' }))
        expect(screen.getByRole('status')).toHaveTextContent(/Development state: no data connected/)
        expect(screen.getByRole('status')).toHaveTextContent(/no reference screenshot yet/)
    })

    it('hamburger collapses the sidebar labels and expands them again', async () => {
        const user = userEvent.setup()
        render(<App />)
        expect(screen.getByText('Parallel farming')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Toggle navigation' }))
        expect(screen.queryByText('Parallel farming')).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Toggle navigation' }))
        expect(screen.getByText('Parallel farming')).toBeInTheDocument()
    })

    it('theme button switches between dark and light and updates its own label', async () => {
        const user = userEvent.setup()
        render(<App />)
        await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))
        expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
    })

    it('palette button is disabled and explains why', () => {
        render(<App />)
        expect(screen.getByRole('button', { name: 'Accent color' })).toBeDisabled()
        expect(screen.getByLabelText(/Accent color choice is not designed yet/)).toBeInTheDocument()
    })

    it('kebab menu opens the design system page', async () => {
        const user = userEvent.setup()
        render(<App />)
        await user.click(screen.getByRole('button', { name: 'More' }))
        await user.click(screen.getByRole('menuitem', { name: /Design system/ }))
        expect(screen.getByRole('heading', { level: 1, name: /Design system/ })).toBeInTheDocument()
    })

    it('keyboard: Tab reaches the hamburger first, Enter activates a focused nav item', async () => {
        const user = userEvent.setup()
        render(<App />)
        await user.tab()
        expect(screen.getByRole('button', { name: 'Toggle navigation' })).toHaveFocus()
        const about = screen.getByRole('button', { name: 'About' })
        about.focus()
        await user.keyboard('{Enter}')
        expect(about).toHaveAttribute('aria-current', 'page')
    })
})
