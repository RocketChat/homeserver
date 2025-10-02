import z from 'zod';
import type { Pdu, PduType } from './v3-11';

export type StateKey = string;

export const eventIdSchema = z.string().brand('EventID');

export type EventID = z.infer<typeof eventIdSchema>;

export const roomIdSchema = z.string().brand('RoomID');

export type RoomID = z.infer<typeof roomIdSchema>;

export const userIdSchema = z.string().brand('UserID');

export type UserID = z.infer<typeof userIdSchema>;

export type StateMapKey = `${PduType}:${StateKey}`;

export type State = Map<StateMapKey, EventID>;

export type PduForType<P extends PduType = PduType> = Extract<Pdu, { type: P }>;

export type PduCreate = PduForType<'m.room.create'>;
