import { Hono } from 'hono'
import { authRoutes, requireAuth, type AppEnv } from './auth'
import { webhookRoutes } from './routes/webhooks'
import { apiRoutes } from './routes/api'
import { mcpRoutes } from './routes/mcp'
import { createDb } from './db'
import { runScheduledTasks } from './scheduler'
import type { Env } from './env'

const app = new Hono<AppEnv>()

app.get('/health', (c) => c.json({ ok: true, name: 'sokuto' }))
app.route('/webhooks', webhookRoutes)
app.route('/api/auth', authRoutes)
app.use('/api/*', requireAuth)
app.route('/api', apiRoutes)
app.route('/mcp', mcpRoutes)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal', message: err instanceof Error ? err.message : String(err) }, 500)
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledTasks(env, createDb(env.DB)))
  },
} satisfies ExportedHandler<Env>
