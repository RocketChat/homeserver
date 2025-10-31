import {
	PersistentEventFactory,
	RoomID,
	UserID,
} from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { type ErrorResponse, ErrorResponseDto } from '../../dtos';
import {
	InternalInviteUserBodyDto,
	type InternalInviteUserResponse,
	InternalInviteUserResponseDto,
} from '../../dtos';

export const internalInvitePlugin = (app: Elysia) => {
	return app.post(
		'/internal/invites',
		async ({ body }): Promise<InternalInviteUserResponse | ErrorResponse> => {
			// try {
			// 	return inviteService.inviteUserToRoom(username, roomId, sender, name);
			// } catch (error) {
			// 	set.status = 500;
			// 	return {
			// 		error: `Failed to invite user: ${error instanceof Error ? error.message : String(error)}`,
			// 		details: {},
			// 	};
			// }
			const { roomId, username, sender } = body;

			const room = await federationSDK.getLatestRoomState(roomId);

			const createEvent = room.get('m.room.create:');

			if (!createEvent || !createEvent.isCreateEvent()) {
				throw new Error('Room create event not found');
			}

			const membershipEvent = PersistentEventFactory.newEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					content: { membership: 'invite' },
					room_id: roomId as RoomID,
					state_key: username as UserID,
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: sender as UserID,
				},
				createEvent.getContent().room_version,
			);

			const statesNeeded = membershipEvent.getAuthEventStateKeys();

			for (const state of statesNeeded) {
				const event = room.get(state);
				if (event) {
					membershipEvent.authedBy(event);
				}
			}

			await federationSDK.handlePdu(membershipEvent);

			if (membershipEvent.rejected) {
				throw new Error(membershipEvent.rejectReason);
			}

			return {
				event_id: membershipEvent.eventId,
				room_id: roomId,
			};
		},
		{
			body: InternalInviteUserBodyDto,
			response: {
				200: InternalInviteUserResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Internal'],
				summary: 'Invite user to room',
				description: 'Invite a user to a room',
			},
		},
	);
};
