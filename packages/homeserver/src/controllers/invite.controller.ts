import { Body, Controller, Inject, Param, Put } from '@nestjs/common';
import { InviteService } from '../services/invite.service';

@Controller('/_matrix/federation/v2')
export class InviteController {
	constructor(private readonly inviteService: InviteService) {}

	@Put('/invite/:roomId/:eventId')
	async receiveInvite(@Body() body: unknown, @Param('roomId') roomId: string, @Param('eventId') eventId: string) {
		return this.inviteService.processInvite(body.event, roomId, eventId);
	}
}

@Controller('/_matrix/federation/v1')
export class InviteControllerV1 {
	constructor(
		@Inject(InviteService) private readonly inviteService: InviteService,
	) {}

	@Put('/invite/:roomId/:eventId')
	async receiveInvite(
		@Param('roomId') roomId: string,
		@Param('eventId') eventId: string,
		@Body() body: unknown,
	) {
		return this.inviteService.processInvite(body.event, roomId, eventId);
	}
}
