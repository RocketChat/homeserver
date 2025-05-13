import { Body, Controller, Inject, Injectable, Param, Put } from '@nestjs/common';
import { InviteService } from '../services/invite.service';

// This controller handles v2 invites
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
		return this.inviteService.processInvite(body.event);
	}
}

// Create a separate controller for v1 invites (legacy)
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
		return this.inviteService.processInvite(body.event);
	}
}
