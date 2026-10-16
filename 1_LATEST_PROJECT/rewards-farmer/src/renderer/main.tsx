import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './global.css'

const container = document.getElementById('root')
if (container === null) throw new Error('Missing #root element')
createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>
)
