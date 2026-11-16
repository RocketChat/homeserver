import { describe, expect, it, mock } from 'bun:test';

import type { EventStagingStore } from '@rocket.chat/federation-core';
import type { EventID, Pdu, RoomID } from '@rocket.chat/federation-room';

import type { ConfigService } from './config.service';
import type { EventAuthorizationService } from './event-authorization.service';
import type { EventEmitterService } from './event-emitter.service';
import type { EventService } from './event.service';
import type { FederationService } from './federation.service';
import type { MissingEventService } from './missing-event.service';
import { StagingAreaService } from './staging-area.service';
import type { StateService } from './state.service';
import type { LockRepository } from '../repositories/lock.repository';

const roomId = '!room:remote.test' as RoomID;
const inviteId = '$invite' as EventID;
const joinRulesId = '$join_rules' as EventID;
const powerLevelsId = '$power_levels' as EventID;

const stagedJoin: EventStagingStore = {
	_id: '$join' as EventID,
	origin: 'remote.test',
	roomId,
	got: 0,
	createdAt: new Date(),
	event: {
		type: 'm.room.member',
		room_id: roomId,
		sender: '@bob:local.test',
		state_key: '@bob:local.test',
		content: { membership: 'join' },
		auth_events: [joinRulesId, inviteId, powerLevelsId],
		prev_events: [inviteId],
		depth: 10,
		origin_server_ts: 0,
		hashes: { sha256: '' },
		signatures: {},
	} as unknown as Pdu,
} as EventStagingStore;

function setup({ fetchById }: { fetchById: boolean }) {
	const eventService = {
		getLeastDepthEventForRoom: mock().mockResolvedValueOnce(stagedJoin).mockResolvedValue(null),
		// the prev event (the invite) is the latest event we hold, the join's other auth events are not stored yet
		checkIfEventsExists: mock(async (ids: EventID[]) => ({
			missing: ids.filter((id) => id !== inviteId),
			found: ids.filter((id) => id === inviteId),
		})),
		getLastEventForRoom: mock().mockResolvedValue({ _id: inviteId }),
		processIncomingPDUs: mock().mockResolvedValue(undefined),
		authorizeAndPersist: mock().mockResolvedValue(undefined),
		markEventAsUnstaged: mock().mockResolvedValue(undefined),
	};
	// nothing lies between the invite and the join on the prev_events path
	const federationService = { getMissingEvents: mock().mockResolvedValue({ events: [] }) };
	const missingEventsService = { fetchMissingEvent: mock().mockResolvedValue(fetchById) };
	const stateService = { getRoomVersion: mock().mockResolvedValue('10') };

	const service = new StagingAreaService(
		{} as ConfigService,
		eventService as unknown as EventService,
		missingEventsService as unknown as MissingEventService,
		{} as EventAuthorizationService,
		{} as EventEmitterService,
		stateService as unknown as StateService,
		federationService as unknown as FederationService,
		{} as LockRepository,
	);

	return { service, eventService, missingEventsService };
}

async function drain(service: StagingAreaService) {
	for await (const _ of service.processEventForRoom(roomId)) {
		// one pass over the staged events
	}
}

describe('StagingAreaService dependency stage', () => {
	it('fetches auth events by id when get_missing_events does not bring them, and postpones the event', async () => {
		const { service, eventService, missingEventsService } = setup({ fetchById: true });

		await drain(service);

		const fetchedIds = missingEventsService.fetchMissingEvent.mock.calls.map(([data]) => data.eventId);
		expect(fetchedIds.sort()).toEqual([joinRulesId, powerLevelsId].sort());
		expect(eventService.authorizeAndPersist).not.toHaveBeenCalled();
		expect(eventService.markEventAsUnstaged).not.toHaveBeenCalled();
	});

	it('postpones the event even when the auth events could not be fetched', async () => {
		const { service, eventService } = setup({ fetchById: false });

		await drain(service);

		expect(eventService.authorizeAndPersist).not.toHaveBeenCalled();
		expect(eventService.markEventAsUnstaged).not.toHaveBeenCalled();
	});
});
