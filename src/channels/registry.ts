import type { Db } from '../db'
import type { Env } from '../env'
import { getChannelConfig } from '../settings'
import type { ChannelAdapter } from './adapter'
import { LineAdapter } from './line'
import { MetaAdapter } from './meta'
import type { Channel } from './types'

export async function getAdapter(env: Env, db: Db, channel: Channel): Promise<ChannelAdapter | null> {
  if (channel === 'line') {
    const cfg = await getChannelConfig(db, env.KV, 'line')
    return cfg ? new LineAdapter(cfg) : null
  }
  const cfg = await getChannelConfig(db, env.KV, 'meta')
  if (!cfg) return null
  if (channel === 'instagram' && !cfg.instagramAccountId) return null
  return new MetaAdapter(channel, cfg, env.META_GRAPH_VERSION || undefined)
}
