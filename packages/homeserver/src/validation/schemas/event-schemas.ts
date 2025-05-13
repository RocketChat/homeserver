import { z } from 'zod';

const baseEventSchema = z.object({
  type: z.string(),
  content: z.record(z.any()).or(z.object({})),
  sender: z.string(),
  room_id: z.string(),
  origin_server_ts: z.number().int().positive(),
  event_id: z.string().optional(),
  state_key: z.string().optional(),
  depth: z.number().int().nonnegative().optional(),
  prev_events: z.array(z.string().or(z.tuple([z.string(), z.string()]))).optional(),
  auth_events: z.array(z.string().or(z.tuple([z.string(), z.string()]))).optional(),
  redacts: z.string().optional(),
  origin: z.string().optional(),
  hashes: z.record(z.string()).optional(),
  signatures: z.record(z.record(z.string())).optional(),
  unsigned: z.any().optional(),
});

const createEventSchema = baseEventSchema.extend({
  type: z.literal('m.room.create'),
  state_key: z.literal(''),
  content: z.object({
    room_version: z.string(),
    creator: z.string(),
  }).and(z.record(z.any())),
  prev_events: z.array(z.any()).max(0).optional(),
  auth_events: z.array(z.any()).max(0).optional(),
});

const memberEventSchema = baseEventSchema.extend({
  type: z.literal('m.room.member'),
  state_key: z.string(),
  content: z.object({
    membership: z.enum(['invite', 'join', 'leave', 'ban', 'knock']),
    displayname: z.string().optional(),
    avatar_url: z.string().optional(),
  }).and(z.record(z.any())),
});

const messageEventSchema = baseEventSchema.extend({
  type: z.literal('m.room.message'),
  content: z.object({
    msgtype: z.string(),
    body: z.string(),
  }).and(z.record(z.any())),
});

const powerLevelsEventSchema = baseEventSchema.extend({
  type: z.literal('m.room.power_levels'),
  state_key: z.literal(''),
  content: z.object({
    ban: z.number().int().default(50),
    kick: z.number().int().default(50),
    redact: z.number().int().default(50),
    invite: z.number().int().default(50),
    events: z.record(z.number().int()).optional(),
    events_default: z.number().int().default(0),
    state_default: z.number().int().default(50),
    users: z.record(z.number().int()).optional(),
    users_default: z.number().int().default(0),
  }).and(z.record(z.any())),
});

const joinRulesEventSchema = baseEventSchema.extend({
  type: z.literal('m.room.join_rules'),
  state_key: z.literal(''),
  content: z.object({
    join_rule: z.enum(['public', 'knock', 'invite', 'private']),
  }).and(z.record(z.any())),
});

const roomV10Schemas = {
  'm.room.create': createEventSchema,
  'm.room.member': memberEventSchema,
  'm.room.message': messageEventSchema,
  'm.room.power_levels': powerLevelsEventSchema,
  'm.room.join_rules': joinRulesEventSchema,
  'default': baseEventSchema,
};

export const eventSchemas: Record<string, Record<string, z.ZodSchema>> = {
  '10': roomV10Schemas,
};

export { roomV10Schemas };

export type BaseEventType = z.infer<typeof baseEventSchema>;