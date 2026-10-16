import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/app-info'

const DEV_URL = process.env['RF_DEV_SERVER_URL']

export function createMainWindow(): BrowserWindow {
    nativeTheme.themeSource = 'dark'

    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 800,
        minHeight: 560,
        title: APP_NAME,
        backgroundColor: '#121318',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    })

    // Window and navigation lockdown (docs/architecture.md section 8).
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
        const allowed = DEV_URL !== undefined && url.startsWith(DEV_URL)
        if (!allowed && !url.startsWith('file://')) event.preventDefault()
    })
    win.webContents.on('will-attach-webview', (event) => event.preventDefault())

    win.once('ready-to-show', () => win.show())

    if (DEV_URL !== undefined) {
        void win.loadURL(DEV_URL)
    } else {
        void win.loadFile(join(__dirname, '../renderer/index.html'))
    }
    return win
}
