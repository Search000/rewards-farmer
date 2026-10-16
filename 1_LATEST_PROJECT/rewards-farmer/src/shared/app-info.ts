export const APP_NAME = 'Rewards Farmer LUCK'

export interface AppInfo {
    readonly name: string
    readonly version: string
    readonly platform: string
    readonly electron: string
    readonly chrome: string
    // true in an installed/packaged build. The development-only design system page is hidden then.
    readonly isPackaged: boolean
}
