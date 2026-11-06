import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import '@channel.io/bezier-react/styles.css'
import App from './App'
import { ThemeRoot } from './lib/theme'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeRoot>
      {/* `m.*` components only (strict): domAnimation covers animate / exit / variants. Under the OS
          "reduce motion" setting Motion drops transforms and keeps opacity. */}
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </MotionConfig>
      </LazyMotion>
    </ThemeRoot>
  </React.StrictMode>,
)
