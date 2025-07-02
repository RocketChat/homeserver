import { container } from 'tsyringe';
import type { RouteDefinition } from '../../types/route.types';
import {
	ErrorResponseDto,
	InternalInviteUserBodyDto,
	InternalInviteUserResponseDto,
} from '../../dtos';
import { StateService } from '../../services/state.service';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import type { PduCreateEventContent } from '@hs/room/src/types/v1';

export const internalInviteRoutes: RouteDefinition[] = [
	{
		method: 'POST',
		path: '/internal/invites',
		handler: async (ctx) => {
			const inviteService = container.resolve(StateService);
			const { roomId, username, sender } = ctx.body;

			const room = await inviteService.getFullRoomState(roomId);

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

			await inviteService.persistStateEvent(membershipEvent);

			if (membershipEvent.rejected) {
				throw new Error(membershipEvent.rejectedReason);
			}

			return {
				event_id: membershipEvent.eventId,
				room_id: roomId,
			};
		},
		validation: {
			body: InternalInviteUserBodyDto,
		},
		responses: {
			200: InternalInviteUserResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Invite user to room',
			description: 'Invite a user to a room',
		},
	},
];
