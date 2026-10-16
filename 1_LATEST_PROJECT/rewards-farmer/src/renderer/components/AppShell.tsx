import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { RouteId } from '../routes'
import type { ThemeMode } from '../tokens'
import { AppBarShell } from './AppBarShell'
import type { EngineIndicator } from './AppBarShell'
import { Sidebar } from './Sidebar'

interface Props {
    readonly engine?: EngineIndicator | undefined
    readonly route: RouteId
    readonly mode: ThemeMode
    readonly onNavigate: (id: RouteId) => void
    readonly onToggleTheme: () => void
    readonly children: ReactNode
}

// Below this width the sidebar becomes an overlay opened by the hamburger.
const NARROW_QUERY = '(max-width:899px)'

export function AppShell({ engine, route, mode, onNavigate, onToggleTheme, children }: Props) {
    const narrow = useMediaQuery(NARROW_QUERY)
    const [collapsed, setCollapsed] = useState(false)
    const [overlayOpen, setOverlayOpen] = useState(false)

    const go = (id: RouteId) => {
        setOverlayOpen(false)
        onNavigate(id)
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                bgcolor: 'background.default',
                color: 'text.primary'
            }}
        >
            <AppBarShell
                engine={engine}
                mode={mode}
                onToggleNav={() => (narrow ? setOverlayOpen((o) => !o) : setCollapsed((c) => !c))}
                onToggleTheme={onToggleTheme}
                onOpenDesignSystem={() => go('design-system')}
            />
            <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
                {narrow ? (
                    <Drawer
                        open={overlayOpen}
                        onClose={() => setOverlayOpen(false)}
                        slotProps={{ paper: { sx: { width: 222 } } }}
                    >
                        <Sidebar current={route} collapsed={false} onNavigate={go} />
                    </Drawer>
                ) : (
                    <>
                        <Sidebar current={route} collapsed={collapsed} onNavigate={go} />
                        <Divider orientation="vertical" flexItem sx={{ my: 1.5 }} />
                    </>
                )}
                <Box
                    component="main"
                    tabIndex={-1}
                    sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: { xs: 1.5, md: 3 } }}
                >
                    <Box
                        sx={{
                            maxWidth: 1000,
                            mx: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2.5
                        }}
                    >
                        {children}
                    </Box>
                </Box>
            </Box>
        </Box>
    )
}
