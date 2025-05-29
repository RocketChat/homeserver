import { Body, Controller, Param, Put } from '@nestjs/common';
import type { ProcessInviteEvent } from '../../services/invite.service';
import { InviteService } from '../../services/invite.service';

@Controller('/_matrix/federation/v2')
export class InviteController {
	constructor(private readonly inviteService: InviteService) {}

	@Put('/invite/:roomId/:eventId')
	async receiveInvite(
		@Body() body: ProcessInviteEvent,
		@Param('roomId') roomId: string,
		@Param('eventId') eventId: string,
	) {
		return this.inviteService.processInvite(body, roomId, eventId);
	}
}
