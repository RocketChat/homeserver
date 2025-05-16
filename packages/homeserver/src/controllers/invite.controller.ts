import { Body, Controller, Put } from '@nestjs/common';
import { InviteService } from '../services/invite.service';

@Controller('/_matrix/federation/v2')
export class InviteController {
	constructor(private readonly inviteService: InviteService) {}

	@Put('/invite/:roomId/:eventId')
	async receiveInvite(@Body() body: unknown) {
		return this.inviteService.processInvite(body);
	}
}