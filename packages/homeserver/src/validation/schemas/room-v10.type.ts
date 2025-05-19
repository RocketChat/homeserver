import { z } from "zod";

const eventId = z.string().regex(/^\$.+$/, "Invalid event_id format");
const userId = z.string().regex(/^@.+:.+$/, "Invalid sender format");
const roomId = z.string().regex(/^!.+:.+$/, "Invalid room_id format");

const hashesSchema = z.record(z.literal('sha256'), z.string());

export const roomV10Schema = z.object({
  auth_events: z.array(eventId),
  content: z.record(z.unknown()),
  depth: z.number().int(),
  hashes: hashesSchema,
  origin_server_ts: z.number().int(),
  origin: z.string(),
  prev_events: z.array(eventId),
  redacts: eventId.optional(),
  room_id: roomId,
  sender: userId,
  signatures: z.record(z.record(z.string())),
  type: z.string(),
  unsigned: z.record(z.unknown()).optional(),
  state_key: z.string().optional(),
});

export type roomV10Type = z.infer<typeof roomV10Schema>;