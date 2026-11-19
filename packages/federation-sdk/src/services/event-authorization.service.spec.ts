import { describe, expect, it } from 'bun:test';

import type { EventID, RoomID } from '@rocket.chat/federation-room';

import type { ConfigService } from './config.service';
import { EventAuthorizationService } from './event-authorization.service';
import type { EventService } from './event.service';
import type { ServerService } from './server.service';
import type { StateService } from './state.service';
import type { AvatarRepository } from '../repositories/avatar.repository';
import type { UploadRepository } from '../repositories/upload.repository';

describe('EventAuthorizationService.canAccessEvent', () => {
	function buildService(storedEvent: unknown) {
		const checkedRooms: RoomID[] = [];
		const service = new EventAuthorizationService(
			{} as StateService,
			{ getEventById: async () => storedEvent } as unknown as EventService,
			{} as ConfigService,
			{} as ServerService,
			{} as UploadRepository,
			{} as AvatarRepository,
		);
		service.serverHasAccessToResource = async (roomId) => {
			checkedRooms.push(roomId);
			return true;
		};

		return { service, checkedRooms };
	}

	it('checks a v12 create event against its top level roomId', async () => {
		const { service, checkedRooms } = buildService({ roomId: '!hash', event: { type: 'm.room.create', content: { room_version: '12' } } });

		expect(await service.canAccessEvent('$hash' as EventID, 'remote.com')).toBeTrue();
		expect(checkedRooms).toEqual(['!hash' as RoomID]);
	});

	it('checks a legacy event against its room_id', async () => {
		const { service, checkedRooms } = buildService({ event: { type: 'm.room.message', room_id: '!legacy:example.com' } });

		expect(await service.canAccessEvent('$event' as EventID, 'remote.com')).toBeTrue();
		expect(checkedRooms).toEqual(['!legacy:example.com' as RoomID]);
	});

	it('denies an unknown event without checking a room', async () => {
		const { service, checkedRooms } = buildService(null);

		expect(await service.canAccessEvent('$event' as EventID, 'remote.com')).toBeFalse();
		expect(checkedRooms).toEqual([]);
	});
});
