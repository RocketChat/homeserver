import { generateHeapSnapshot } from 'bun';
import { PduV1NoContentSchema, generatePduSchemaForBase } from './v1';

import { z } from 'zod';

// SPEC: https://spec.matrix.org/v1.12/rooms/v3/#event-format
// 1. When events are sent over federation, the event_id field is no longer included. A server receiving an event should compute the relevant event ID for itself.
// 2. Additionally, the format of the auth_events and prev_events fields are changed: instead of lists of (event_id, hash) pairs, they are now plain lists of event IDs.
//

const base = {
	...z.object(PduV1NoContentSchema).omit({ event_id: true }).shape,
	auth_events: z
		.array(z.string())
		.describe(
			'A list of event IDs that are required in the room state before this event can be applied. The server will not send this event if it is not satisfied.',
		),
	prev_events: z
		.array(z.string())
		.describe(
			'A list of event IDs that are required in the room state before this event can be applied. The server will not send this event if it is not satisfied.',
		),
};

export const PduV3Schema = generatePduSchemaForBase(base);

export type PduV3 = z.infer<typeof PduV3Schema>;
