import { describe, expect, mock, test } from 'bun:test';

import { type PduForType, PersistentEventFactory, type RoomID, type State } from '@rocket.chat/federation-room';

import type { ConfigService } from './config.service';
import type { EventEmitterService } from './event-emitter.service';
import type { EventService } from './event.service';
import type { FederationService } from './federation.service';
import { SendJoinService } from './send-join.service';
import type { StateService } from './state.service';
import type { StickyEventService } from './sticky-event.service';

const ROOM_ID = '!room:hs1' as RoomID;

describe('SendJoinService.sendJoin', () => {
	test('lets the server of the joining user catch up, judged on the room state before the join', async () => {
		const join = PersistentEventFactory.createFromRawEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				state_key: '@dave:hs3',
				content: { membership: 'join' },
				room_id: ROOM_ID,
				sender: '@dave:hs3',
				origin_server_ts: 1_700_000_000_000,
				depth: 4,
				auth_events: [],
				prev_events: [],
			} as unknown as PduForType<'m.room.member'>,
			'10',
		);
		const stateBefore = new Map() as State;
		const catchUpIfNewServer = mock(async () => 'hs3');
		const handlePdu = mock(async () => undefined);

		const service = new SendJoinService(
			{ getEventsByIds: async () => [] } as unknown as EventService,
			{ emit: async () => undefined } as unknown as EventEmitterService,
			{
				getRoomVersion: async () => '10',
				buildEvent: async () => join,
				getLatestRoomState: async () => stateBefore,
				handlePdu,
				signEvent: async (event: unknown) => event,
			} as unknown as StateService,
			{ serverName: 'hs1' } as ConfigService,
			{ sendEventToAllServersInRoom: async () => undefined } as unknown as FederationService,
			{ catchUpIfNewServer } as unknown as StickyEventService,
		);

		await service.sendJoin(ROOM_ID, join.eventId, join.event);

		expect(catchUpIfNewServer).toHaveBeenCalledWith(join, stateBefore);
		expect(handlePdu.mock.invocationCallOrder[0]).toBeLessThan(catchUpIfNewServer.mock.invocationCallOrder[0]);
	});
});
