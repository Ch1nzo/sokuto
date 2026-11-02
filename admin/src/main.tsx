import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@channel.io/bezier-react/styles.css'
import App from './App'
import { ThemeRoot } from './lib/theme'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeRoot>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeRoot>
  </React.StrictMode>,
)
