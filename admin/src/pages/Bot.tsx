import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api } from '../lib/api'
import { BotContext } from './bot/shared'
import type { BotResponse } from './bot/types'
import Overview from './bot/Overview'
import Rules from './bot/Rules'
import Knowledge from './bot/Knowledge'
import Products from './bot/Products'
import Playground from './bot/Playground'
import './bot.css'

/** Soku (reply bot): /bot, /bot/rules, /bot/knowledge, /bot/products, /bot/playground. Loads GET /api/bot once for all of them. */
export default function Bot() {
  const [bot, setBot] = useState<BotResponse | null>(null)
  const [error, setError] = useState<unknown>(null)

  const reload = useCallback(async () => {
    try {
      setBot(await api.get<BotResponse>('/api/bot'))
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo(() => ({ bot, error, reload, setBot }), [bot, error, reload])

  return (
    <BotContext.Provider value={value}>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="rules" element={<Rules />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="products" element={<Products />} />
        <Route path="playground" element={<Playground />} />
        <Route path="*" element={<Navigate to="/bot" replace />} />
      </Routes>
    </BotContext.Provider>
  )
}
