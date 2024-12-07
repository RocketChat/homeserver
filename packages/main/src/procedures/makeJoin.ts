import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import type { EventStore } from "../mongodb";
import { IncompatibleRoomVersionError } from "../errors";
import { roomMemberEvent } from "../events/m.room.member";

// "method":"GET",
// "url":"http://rc1:443/_matrix/federation/v1/make_join/%21kwkcWPpOXEJvlcollu%3Arc1/%40admin%3Ahs1?ver=1&ver=2&ver=3&ver=4&ver=5&ver=6&ver=7&ver=8&ver=9&ver=10&ver=11&ver=org.matrix.msc3757.10&ver=org.matrix.msc3757.11",

export const makeJoinEventBuilder =
	(
		getLastEvent: (roomId: string) => Promise<EventStore>,
		getAuthEvents: (roomId: string) => Promise<EventStore[]>,
	) =>
	async (
		roomId: string,
		userId: string,
		roomVersion: string,
		origin: string,
	) => {
		if (roomVersion !== "10") {
			throw new IncompatibleRoomVersionError(
				"Your homeserver does not support the features required to join this room",
				{ roomVersion: "10" },
			);
		}
		const lastEvent = await getLastEvent(roomId);
		const authEvents = await getAuthEvents(roomId);
		const event = roomMemberEvent({
			membership: "join",
			roomId,
			sender: userId,
			state_key: userId,
			auth_events: authEvents.map((event) => event._id),
			prev_events: [lastEvent._id],
			depth: lastEvent.event.depth + 1,
			origin,
			ts: Date.now(),
		});

		return {
			event,
			room_version: "10",
		};
	};
