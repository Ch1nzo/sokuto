import { integer, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = () => new Date().toISOString()

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
})

export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channel: text('channel').notNull(),
    channelUserId: text('channel_user_id').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    username: text('username'),
    /** JSON object of custom fields (phone, email, ...). */
    fields: text('fields').notNull().default('{}'),
    botPaused: integer('bot_paused').notNull().default(0),
    botPausedUntil: text('bot_paused_until'),
    lastInboundAt: text('last_inbound_at'),
    lastOutboundAt: text('last_outbound_at'),
    unread: integer('unread').notNull().default(0),
    createdAt: text('created_at').notNull().$defaultFn(now),
    updatedAt: text('updated_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('contacts_channel_user').on(t.channel, t.channelUserId), index('contacts_last_inbound').on(t.lastInboundAt)],
)

export const contactTags = sqliteTable(
  'contact_tags',
  {
    contactId: integer('contact_id').notNull(),
    tag: text('tag').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('contact_tags_unique').on(t.contactId, t.tag), index('contact_tags_tag').on(t.tag)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contactId: integer('contact_id').notNull(),
    direction: text('direction').notNull(), // in | out
    source: text('source').notNull(), // user | bot | human | system
    kind: text('kind').notNull(), // text | image | postback | comment | event
    text: text('text'),
    payload: text('payload'), // JSON
    flowId: integer('flow_id'),
    stepId: text('step_id'),
    error: text('error'),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('messages_contact').on(t.contactId, t.createdAt)],
)

export const flows = sqliteTable('flows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  channel: text('channel').notNull().default('any'),
  status: text('status').notNull().default('draft'),
  definition: text('definition').notNull(), // JSON FlowDefinition
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
})

export const sessions = sqliteTable(
  'sessions',
  {
    contactId: integer('contact_id').primaryKey(),
    flowId: integer('flow_id').notNull(),
    stepId: text('step_id'),
    /** What the session waits for: input | button | delay */
    waiting: text('waiting'),
    field: text('field'),
    resumeAt: text('resume_at'),
    context: text('context').notNull().default('{}'),
    updatedAt: text('updated_at').notNull().$defaultFn(now),
  },
  (t) => [index('sessions_resume').on(t.resumeAt)],
)

export const broadcasts = sqliteTable('broadcasts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  channel: text('channel').notNull().default('any'),
  tag: text('tag'),
  text: text('text').notNull(),
  imageUrl: text('image_url'),
  status: text('status').notNull().default('scheduled'), // scheduled | running | done | canceled
  total: integer('total').notNull().default(0),
  sent: integer('sent').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  scheduledAt: text('scheduled_at').notNull().$defaultFn(now),
  createdAt: text('created_at').notNull().$defaultFn(now),
})

export const broadcastJobs = sqliteTable(
  'broadcast_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    broadcastId: integer('broadcast_id').notNull(),
    contactId: integer('contact_id').notNull(),
    status: text('status').notNull().default('pending'), // pending | sent | failed | skipped
    error: text('error'),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('broadcast_jobs_status').on(t.broadcastId, t.status)],
)

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(), // trigger_fired | step_sent | button_clicked | input_saved | flow_completed | comment_replied | error
    channel: text('channel'),
    flowId: integer('flow_id'),
    stepId: text('step_id'),
    contactId: integer('contact_id'),
    meta: text('meta'),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('events_created').on(t.createdAt), index('events_flow').on(t.flowId, t.type)],
)

export const processedEvents = sqliteTable('processed_events', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull().$defaultFn(now),
})

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contactId: integer('contact_id'),
    text: text('text').notNull(),
    read: integer('read').notNull().default(0),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('notifications_read').on(t.read, t.createdAt)],
)
