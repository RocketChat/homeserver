import { EventID, RoomID } from '@rocket.chat/federation-room';
import { InviteService } from '@rocket.chat/federation-sdk';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import { ProcessInviteParamsDto, RoomVersionDto } from '../../dtos';

export const invitePlugin = (app: Elysia) => {
	const inviteService = container.resolve(InviteService);
	return app.put(
		'/_matrix/federation/v2/invite/:roomId/:eventId',
		async ({ body, params: { roomId, eventId } }) => {
			return inviteService.processInvite(
				body.event,
				roomId as RoomID,
				eventId as EventID,
				body.room_version,
			);
		},
		{
			params: ProcessInviteParamsDto,
			body: t.Object({
				event: t.Any(),
				room_version: RoomVersionDto,
				invite_room_state: t.Any(),
			}),
			detail: {
				tags: ['Federation'],
				summary: 'Process room invite',
				description: 'Process an invite event from another Matrix server',
			},
		},
	);
};
