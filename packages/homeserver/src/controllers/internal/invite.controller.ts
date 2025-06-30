import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	type ErrorResponse,
	ErrorResponseDto,
	InternalInviteUserBodyDto,
	type InternalInviteUserResponse,
	InternalInviteUserResponseDto,
} from '../../dtos';
import { InviteService } from '@hs/federation-sdk/src/services/invite.service';
import { StateService } from '@hs/federation-sdk/src/services/state.service';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import type { PduCreateEventContent } from '@hs/room/src/types/v1';

export const internalInvitePlugin = (app: Elysia) => {
	const _inviteService = container.resolve(InviteService);
	const stateService = container.resolve(StateService);
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

			const room = await stateService.getFullRoomState(roomId);

			const createEvent = room.get('m.room.create:');

			if (!createEvent) {
				throw new Error('Room create event not found');
			}

			const membershipEvent = PersistentEventFactory.newMembershipEvent(
				roomId,
				sender,
				username,
				'invite',
				createEvent.getContent<PduCreateEventContent>(),
			);

			const statesNeeded = membershipEvent.getAuthEventStateKeys();

			for (const state of statesNeeded) {
				const event = room.get(state);
				if (event) {
					membershipEvent.authedBy(event);
				}
			}

			await stateService.persistStateEvent(membershipEvent);

			if (membershipEvent.rejected) {
				throw new Error(membershipEvent.rejectedReason);
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
