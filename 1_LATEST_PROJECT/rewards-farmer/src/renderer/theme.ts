import { createTheme } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'
import { darkTokens, lightTokens } from './tokens'
import type { ThemeMode, Tokens } from './tokens'

export function tokensFor(mode: ThemeMode): Tokens {
    return mode === 'dark' ? darkTokens : lightTokens
}

export function buildTheme(mode: ThemeMode): Theme {
    const t = tokensFor(mode)
    return createTheme({
        palette: {
            mode,
            primary: { main: t.primary, contrastText: t.onPrimary },
            background: { default: t.background, paper: t.card },
            text: { primary: t.textPrimary, secondary: t.textSecondary },
            divider: t.divider
        },
        shape: { borderRadius: 12 },
        spacing: 8,
        typography: {
            fontFamily: '"Roboto", "Segoe UI", system-ui, sans-serif',
            h1: { fontSize: '1.3rem', fontWeight: 400 },
            h2: { fontSize: '1.25rem', fontWeight: 400 },
            subtitle1: { fontSize: '0.95rem', fontWeight: 500 },
            body1: { fontSize: '0.875rem' },
            body2: { fontSize: '0.8125rem' },
            button: { textTransform: 'none', fontWeight: 500 }
        },
        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    body: { backgroundColor: t.background },
                    ':focus-visible': { outline: `2px solid ${t.primary}`, outlineOffset: '2px' }
                }
            },
            MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
            MuiButton: {
                defaultProps: { disableElevation: true },
                styleOverrides: {
                    root: {
                        borderRadius: 12,
                        '&.Mui-disabled': { backgroundColor: t.disabledSurface }
                    }
                }
            },
            MuiOutlinedInput: {
                styleOverrides: {
                    root: { borderRadius: 4, backgroundColor: t.card }
                }
            }
        }
    })
}
