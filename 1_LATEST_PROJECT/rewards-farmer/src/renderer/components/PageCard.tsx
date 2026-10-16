import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useId } from 'react'
import type { ReactNode } from 'react'

interface Props {
    readonly title: string
    readonly children: ReactNode
}

// Big page card with a centered title and a divider below it (screenshot 1 "Farmer", screenshot 3 "Settings").
export function PageCard({ title, children }: Props) {
    const id = useId()
    return (
        <Paper component="section" aria-labelledby={id} sx={{ borderRadius: 3, p: 2, pb: 2.5 }}>
            <Typography id={id} variant="h1" component="h1" align="center" sx={{ pb: 1.25 }}>
                {title}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {children}
        </Paper>
    )
}

interface InfoCardProps {
    readonly icon: ReactNode
    readonly title: string
    readonly subtitle: string
    readonly children: ReactNode
}

// Smaller info card (screenshot 1 "Current account", "Accounts informations").
export function InfoCard({ icon, title, subtitle, children }: InfoCardProps) {
    const id = useId()
    return (
        <Paper
            component="section"
            aria-labelledby={id}
            sx={{ borderRadius: 3, p: 2, flex: 1, minWidth: 280 }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 1.5, pt: 1, pb: 2 }}>
                <Box aria-hidden sx={{ display: 'flex', color: 'text.secondary' }}>
                    {icon}
                </Box>
                <Box>
                    <Typography id={id} variant="subtitle1" component="h2">
                        {title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {subtitle}
                    </Typography>
                </Box>
            </Box>
            {children}
        </Paper>
    )
}

interface StatRowProps {
    readonly label: string
    // Pass '-' (or 'unknown') when a value is not available. Never a made-up number.
    readonly value: string
}

export function StatRow({ label, value }: StatRowProps) {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {label}
            </Typography>
            <Typography variant="body2">{value}</Typography>
        </Box>
    )
}
