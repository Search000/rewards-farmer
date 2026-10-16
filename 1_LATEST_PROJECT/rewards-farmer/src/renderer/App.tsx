import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FarmerState } from '../shared/farmer-types'
import type { RouteId } from './routes'
import { AppShell } from './components/AppShell'
import { ConfirmDialog } from './components/ConfirmDialog'
import type { EngineIndicator } from './components/AppBarShell'
import { NotificationProvider } from './components/Notifications'
import { useFarmerState } from './hooks/useFarmerState'
import { useHashRoute } from './hooks/useHashRoute'
import { AccountsPage } from './pages/AccountsPage'
import { BackupsPage } from './pages/BackupsPage'
import { DesignSystemPage } from './pages/DesignSystemPage'
import { HealthPage } from './pages/HealthPage'
import { HomePage } from './pages/HomePage'
import { LogsPage } from './pages/LogsPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SecretsPage } from './pages/SecretsPage'
import { SettingsPage } from './pages/SettingsPage'
import { WizardPage } from './pages/WizardPage'
import { buildTheme } from './theme'
import type { ThemeMode } from './tokens'

function engineIndicator(state: FarmerState | null): EngineIndicator | undefined {
    if (state === null) return undefined
    const v = state.engine.version === null ? '' : ` (v${state.engine.version})`
    switch (state.engine.link) {
        case 'ready':
            return { connected: true, label: `Engine: ready${v}` }
        case 'starting':
            return { connected: false, label: 'Engine: starting' }
        case 'down':
            return { connected: false, label: 'Engine: stopped or crashed' }
        case 'failed':
            return { connected: false, label: 'Engine: failed to start' }
        default:
            return { connected: false, label: 'Engine: not started' }
    }
}

export function App() {
    const [route, navigate] = useHashRoute()
    const farmer = useFarmerState()
    const [mode, setMode] = useState<ThemeMode>('dark')
    // Unsaved changes on the Settings page: leaving the page asks first.
    const [settingsDirty, setSettingsDirty] = useState(false)
    const [pendingRoute, setPendingRoute] = useState<RouteId | null>(null)
    const guardedNavigate = useCallback(
        (next: RouteId) => {
            if (settingsDirty && route === 'settings' && next !== 'settings') setPendingRoute(next)
            else navigate(next)
        },
        [settingsDirty, route, navigate]
    )
    const theme = useMemo(() => buildTheme(mode), [mode])

    // The theme choice lives in the main-process settings file, so it survives a restart. Outside Electron it stays in memory.
    const api = farmer.api
    useEffect(() => {
        if (api === null) return
        void api.getSettings().then(
            (s) => setMode(s.themeMode),
            () => undefined // keep the default; the Home page reports real engine problems
        )
    }, [api])

    // First start (Phase 22): the main process says whether the setup wizard should open. Asked once; only a real answer of
    // `true` moves the window. If the question fails the app just opens on Home as before.
    useEffect(() => {
        if (api === null) return
        void api.wizardIsFirstRun().then(
            (first) => {
                if (first) navigate('setup')
            },
            () => undefined
        )
    }, [api, navigate])

    const toggleTheme = useCallback(() => {
        const next: ThemeMode = mode === 'dark' ? 'light' : 'dark'
        setMode(next)
        if (api !== null) void api.setThemeMode(next).catch(() => undefined)
    }, [mode, api])

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <NotificationProvider>
                <AppShell
                    engine={engineIndicator(farmer.state)}
                    route={route}
                    mode={mode}
                    onNavigate={guardedNavigate}
                    onToggleTheme={toggleTheme}
                >
                    {route === 'design-system' ? (
                        <DesignSystemPage />
                    ) : route === 'home' ? (
                        <HomePage farmer={farmer} />
                    ) : route === 'accounts' ? (
                        <AccountsPage farmer={farmer} />
                    ) : route === 'logs' ? (
                        <LogsPage farmer={farmer} />
                    ) : route === 'health' ? (
                        <HealthPage farmer={farmer} />
                    ) : route === 'backups' ? (
                        <BackupsPage farmer={farmer} />
                    ) : route === 'secrets' ? (
                        <SecretsPage farmer={farmer} />
                    ) : route === 'notifications' ? (
                        <NotificationsPage farmer={farmer} />
                    ) : route === 'setup' ? (
                        <WizardPage
                            farmer={farmer}
                            mode={mode}
                            onThemeApplied={setMode}
                            onLeave={() => navigate('home')}
                        />
                    ) : route === 'settings' ? (
                        <SettingsPage farmer={farmer} onDirtyChange={setSettingsDirty} />
                    ) : (
                        <PlaceholderPage route={route} />
                    )}
                </AppShell>
                <ConfirmDialog
                    open={pendingRoute !== null}
                    title="Leave without saving?"
                    message="You have unsaved changes on the Settings page. If you leave now they are lost."
                    confirmLabel="Leave"
                    cancelLabel="Stay"
                    onCancel={() => setPendingRoute(null)}
                    onConfirm={() => {
                        const next = pendingRoute
                        setPendingRoute(null)
                        setSettingsDirty(false)
                        if (next !== null) navigate(next)
                    }}
                />
            </NotificationProvider>
        </ThemeProvider>
    )
}
