import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	ProcessInviteBodyDto,
	ProcessInviteParamsDto,
	ProcessInviteResponseDto,
} from '../../dtos/federation/invite.dto';
import { InviteService } from '@hs/federation-sdk/src/services/invite.service';

export const invitePlugin = (app: Elysia) => {
	const inviteService = container.resolve(InviteService);
	return app.put(
		'/_matrix/federation/v2/invite/:roomId/:eventId',
		async ({ body, params: { roomId, eventId } }) => {
			return inviteService.processInvite(body, roomId, eventId);
		},
		{
			params: ProcessInviteParamsDto,
			body: ProcessInviteBodyDto,
			response: {
				200: ProcessInviteResponseDto,
			},
			detail: {
				tags: ['Federation'],
				summary: 'Process room invite',
				description: 'Process an invite event from another Matrix server',
			},
		},
	);
};
