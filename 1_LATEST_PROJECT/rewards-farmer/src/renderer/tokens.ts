// Colors sampled from the user's reference screenshots (shot 1 and shot 3, dark theme) with Pillow.
// Light values are DERIVED (no light-theme screenshot exists) and are marked as such.
export const darkTokens = {
    background: '#121318', // body, sidebar (sampled)
    card: '#1c1b21', // cards and fields (sampled)
    appBar: '#35343a', // app bar (sampled)
    divider: '#35363b', // sidebar divider (sampled)
    navPill: '#424558', // active nav pill (sampled)
    primaryContainer: '#394279', // "Open" buttons (sampled)
    primary: '#bac2ff', // switch track when on (sampled)
    onPrimary: '#1f295c', // switch thumb when on (sampled)
    disabledSurface: '#2d2c31', // disabled Stop/Start buttons (sampled)
    switchOff: '#8a8a94', // switch off track/thumb (sampled)
    textPrimary: '#e4e1e9',
    textSecondary: '#c6c5d0'
} as const

export const lightTokens = {
    background: '#fbf8ff',
    card: '#f1effa',
    appBar: '#e3e1ec',
    divider: '#c7c5d0',
    navPill: '#dce1ff',
    primaryContainer: '#dce1ff',
    primary: '#4a58a9',
    onPrimary: '#ffffff',
    disabledSurface: '#e4e1e9',
    switchOff: '#767680',
    textPrimary: '#1b1b21',
    textSecondary: '#46464f'
} as const

export type Tokens = { readonly [K in keyof typeof darkTokens]: string }
export type ThemeMode = 'dark' | 'light'
