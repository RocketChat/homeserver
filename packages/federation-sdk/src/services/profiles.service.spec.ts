import { describe, expect, it } from 'bun:test';

import { IncompatibleRoomVersionError } from '@rocket.chat/federation-core';
import type { PduForType, RoomID, RoomVersion, UserID } from '@rocket.chat/federation-room';

import { ProfilesService } from './profiles.service';
import type { StateService } from './state.service';

const roomId = '!room:hs1' as RoomID;
const userId = '@alice:hs2' as UserID;

function buildService(roomVersion: RoomVersion) {
	const membershipEvent = {
		type: 'm.room.member',
		room_id: roomId,
		sender: userId,
		state_key: userId,
		content: { membership: 'join' },
	} as unknown as PduForType<'m.room.member'>;

	// captured so the template's room version can be asserted, not just its shape
	const built: { roomVersion?: RoomVersion } = {};

	const stateService = {
		async getRoomVersion() {
			return roomVersion;
		},
		async getLatestRoomState2() {
			return { isUserInvited: () => true };
		},
		async buildEvent(_event: unknown, version: RoomVersion) {
			built.roomVersion = version;
			return { event: membershipEvent };
		},
	} as unknown as StateService;

	return { service: new ProfilesService(null as never, stateService, null as never), membershipEvent, built };
}

describe('makeJoin', () => {
	it('reports the room version the asking server is missing support for', async () => {
		const { service } = buildService('11');

		// the asking server advertised only up to v10, the room is v11
		const error = await service.makeJoin(roomId, userId, ['10'] as RoomVersion[]).catch((e: IncompatibleRoomVersionError) => e);

		expect(error).toBeInstanceOf(IncompatibleRoomVersionError);
		expect(error.errcode).toBe('M_INCOMPATIBLE_ROOM_VERSION');
		expect(error.status).toBe(400);

		// room_version is required on this errcode, it is how the remote learns what it needs
		expect(error.toJSON()).toEqual({
			errcode: 'M_INCOMPATIBLE_ROOM_VERSION',
			error: 'Your homeserver does not support the features required to join this room',
			room_version: '11',
		});
	});

	it('builds a join template at the room version when the asking server supports it', async () => {
		const { service, membershipEvent, built } = buildService('10');

		await expect(service.makeJoin(roomId, userId, ['9', '10', '11'] as RoomVersion[])).resolves.toEqual({
			room_version: '10',
			event: membershipEvent,
		});

		// the template has to be built at the room's version, not at the default
		expect(built.roomVersion).toBe('10');
	});
});
