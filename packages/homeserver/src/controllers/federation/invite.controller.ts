import {
	ProcessInviteBodyDto,
	ProcessInviteParamsDto,
	ProcessInviteResponseDto,
} from '@hs/federation-sdk';
import { InviteService } from '@hs/federation-sdk';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';

export const invitePlugin = (app: Elysia) => {
	const inviteService = container.resolve(InviteService);
	return app.put(
		'/_matrix/federation/v2/invite/:roomId/:eventId',
		async ({ body, params: { roomId, eventId } }) => {
			return inviteService.processInvite(
				body.event,
				roomId,
				eventId,
				body.room_version,
			);
		},
		{
			params: ProcessInviteParamsDto,
			body: t.Object({
				event: t.Any(),
				room_version: t.String(),
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
