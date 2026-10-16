import BackupIcon from '@mui/icons-material/BackupOutlined'
import DashboardIcon from '@mui/icons-material/Dashboard'
import HealthIcon from '@mui/icons-material/HealthAndSafetyOutlined'
import HomeIcon from '@mui/icons-material/Home'
import InfoIcon from '@mui/icons-material/Info'
import KeyIcon from '@mui/icons-material/KeyOutlined'
import ListAltIcon from '@mui/icons-material/ListAlt'
import NotificationsIcon from '@mui/icons-material/NotificationsOutlined'
import PeopleIcon from '@mui/icons-material/People'
import SettingsIcon from '@mui/icons-material/Settings'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import type { ReactElement } from 'react'
import { ROUTES } from '../routes'
import type { RouteId } from '../routes'
import { tokensFor } from '../theme'

const ICONS: Partial<Record<RouteId, ReactElement>> = {
    home: <HomeIcon />,
    accounts: <PeopleIcon />,
    parallel: <DashboardIcon />,
    secrets: <KeyIcon />,
    notifications: <NotificationsIcon />,
    logs: <ListAltIcon />,
    health: <HealthIcon />,
    backups: <BackupIcon />,
    settings: <SettingsIcon />,
    about: <InfoIcon />
}

interface Props {
    readonly current: RouteId
    readonly collapsed: boolean
    readonly onNavigate: (id: RouteId) => void
}

export function Sidebar({ current, collapsed, onNavigate }: Props) {
    const t = tokensFor(useTheme().palette.mode)
    return (
        <Box
            component="nav"
            aria-label="Main navigation"
            sx={{ width: collapsed ? 72 : 222, flexShrink: 0, pt: 2, transition: 'width 120ms' }}
        >
            <List disablePadding>
                {ROUTES.filter((r) => r.inSidebar).map((r) => {
                    const selected = current === r.id
                    return (
                        <ListItemButton
                            key={r.id}
                            disableRipple
                            aria-current={selected ? 'page' : undefined}
                            aria-label={r.label}
                            onClick={() => onNavigate(r.id)}
                            sx={{
                                height: 36.5,
                                px: 2.25,
                                gap: 1.5,
                                borderRadius: 0,
                                bgcolor: 'transparent !important'
                            }}
                        >
                            <Box
                                aria-hidden
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 47,
                                    height: 26,
                                    borderRadius: 13,
                                    bgcolor: selected ? t.navPill : 'transparent',
                                    '& svg': { fontSize: 20 }
                                }}
                            >
                                {ICONS[r.id]}
                            </Box>
                            {!collapsed && (
                                <Typography variant="body2" sx={{ fontSize: '0.6875rem', fontWeight: 500 }}>
                                    {r.label}
                                </Typography>
                            )}
                        </ListItemButton>
                    )
                })}
            </List>
        </Box>
    )
}
