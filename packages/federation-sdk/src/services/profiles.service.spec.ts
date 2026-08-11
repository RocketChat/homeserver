import { describe, expect, it } from 'bun:test';

import { IncompatibleRoomVersionError } from '@rocket.chat/federation-core';
import type { RoomID, RoomVersion, UserID } from '@rocket.chat/federation-room';

import { ProfilesService } from './profiles.service';
import type { StateService } from './state.service';

function buildService(roomVersion: RoomVersion) {
	const stateService = {
		async getRoomVersion() {
			return roomVersion;
		},
	} as unknown as StateService;

	return new ProfilesService(null as never, stateService, null as never);
}

describe('makeJoin', () => {
	it('reports the room version the asking server is missing support for', async () => {
		const service = buildService('11');

		// the asking server advertised only up to v10, the room is v11
		const makeJoin = service.makeJoin('!room:hs1' as RoomID, '@alice:hs2' as UserID, ['10'] as RoomVersion[]);

		await expect(makeJoin).rejects.toBeInstanceOf(IncompatibleRoomVersionError);

		const error = await makeJoin.catch((e: IncompatibleRoomVersionError) => e);

		expect(error.errcode).toBe('M_INCOMPATIBLE_ROOM_VERSION');
		expect(error.status).toBe(400);

		// room_version is required on this errcode, it is how the remote learns what it needs
		expect(error.toJSON()).toEqual({
			errcode: 'M_INCOMPATIBLE_ROOM_VERSION',
			error: 'Your homeserver does not support the features required to join this room',
			room_version: '11',
		});
	});

	it('does not reject a version the asking server advertised', async () => {
		const service = buildService('10');

		// gets past the version check and fails later, on state we did not stub
		const makeJoin = service.makeJoin('!room:hs1' as RoomID, '@alice:hs2' as UserID, ['9', '10', '11'] as RoomVersion[]);

		await expect(makeJoin).rejects.not.toBeInstanceOf(IncompatibleRoomVersionError);
	});
});
