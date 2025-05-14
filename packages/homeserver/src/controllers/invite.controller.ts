import { Body, Controller, Inject, Injectable, Param, Put } from '@nestjs/common';
import { InviteService } from '../services/invite.service';

@Controller('/_matrix/federation/v2')
@Injectable()
export class InviteController {
	constructor(
		@Inject(InviteService) private readonly inviteService: InviteService,
	) {}

	@Put('/invite/:roomId/:eventId')
	async receiveInvite(
		@Param('roomId') roomId: string,
		@Param('eventId') eventId: string,
		@Body() body: any,
	) {
		return this.inviteService.processInvite(body.event, roomId, eventId);
	}
}

@Controller('/_matrix/federation/v1')
@Injectable()
export class InviteControllerV1 {
	constructor(
		@Inject(InviteService) private readonly inviteService: InviteService,
	) {}

	@Put('/invite/:roomId/:eventId')
	async receiveInvite(
		@Param('roomId') roomId: string,
		@Param('eventId') eventId: string,
		@Body() body: any,
	) {
		return this.inviteService.processInvite(body.event, roomId, eventId);
	}
}
