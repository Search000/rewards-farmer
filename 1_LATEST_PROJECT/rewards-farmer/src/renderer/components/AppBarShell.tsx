import BrightnessIcon from '@mui/icons-material/Brightness7'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import MenuIcon from '@mui/icons-material/Menu'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PaletteIcon from '@mui/icons-material/Palette'
import SensorsIcon from '@mui/icons-material/Sensors'
import SensorsOffIcon from '@mui/icons-material/SensorsOff'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useId, useState } from 'react'
import { APP_NAME } from '../../shared/app-info'
import type { ThemeMode } from '../tokens'
import { tokensFor } from '../theme'
import { DisabledReason } from './DisabledReason'
import { Hint } from './Hint'

export interface EngineIndicator {
    readonly connected: boolean
    // Short text for the tooltip and the screen reader, for example "Engine: ready (v4.3.2.4)".
    readonly label: string
}

interface Props {
    // undefined = no engine information available at all (for example in a plain browser): shown as not connected.
    readonly engine?: EngineIndicator | undefined
    readonly mode: ThemeMode
    readonly onToggleNav: () => void
    readonly onToggleTheme: () => void
    readonly onOpenDesignSystem: () => void
}

export function AppBarShell({ engine, mode, onToggleNav, onToggleTheme, onOpenDesignSystem }: Props) {
    const engineLabel = engine?.label ?? 'Engine: not connected'
    const engineOn = engine?.connected === true
    const t = tokensFor(useTheme().palette.mode)
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const menuId = useId()
    return (
        <AppBar
            position="static"
            elevation={0}
            sx={{ bgcolor: t.appBar, color: t.textPrimary, backgroundImage: 'none' }}
        >
            <Toolbar variant="dense" disableGutters sx={{ minHeight: 46, gap: 0, pl: '1px', pr: 0 }}>
                <IconButton size="small" color="inherit" aria-label="Toggle navigation" onClick={onToggleNav}>
                    <MenuIcon />
                </IconButton>
                <Typography variant="h2" component="div" sx={{ ml: '12px', flexGrow: 1 }}>
                    {APP_NAME}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <Hint text={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
                        <IconButton
                            size="small"
                            color="inherit"
                            aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                            onClick={onToggleTheme}
                        >
                            {mode === 'dark' ? <BrightnessIcon /> : <DarkModeIcon />}
                        </IconButton>
                    </Hint>
                    <DisabledReason reason="Accent color choice is not designed yet (no reference screenshot of its menu).">
                        <IconButton size="small" color="inherit" aria-label="Accent color" disabled>
                            <PaletteIcon />
                        </IconButton>
                    </DisabledReason>
                    <Hint text={engineLabel}>
                        <Box
                            role="img"
                            aria-label={engineLabel}
                            sx={{
                                display: 'flex',
                                p: 0.75,
                                color: engineOn ? 'success.main' : 'text.secondary'
                            }}
                        >
                            {engineOn ? <SensorsIcon /> : <SensorsOffIcon />}
                        </Box>
                    </Hint>
                    <IconButton
                        size="small"
                        color="inherit"
                        aria-label="More"
                        aria-controls={anchor === null ? undefined : menuId}
                        aria-haspopup="true"
                        onClick={(e) => setAnchor(e.currentTarget)}
                    >
                        <MoreVertIcon />
                    </IconButton>
                    <Menu
                        id={menuId}
                        anchorEl={anchor}
                        open={anchor !== null}
                        onClose={() => setAnchor(null)}
                    >
                        <MenuItem
                            onClick={() => {
                                setAnchor(null)
                                onOpenDesignSystem()
                            }}
                        >
                            Design system (development)
                        </MenuItem>
                    </Menu>
                </Box>
            </Toolbar>
        </AppBar>
    )
}
