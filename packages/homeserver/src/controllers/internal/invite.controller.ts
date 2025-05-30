import {
	Body,
	Controller,
	HttpException,
	HttpStatus,
	Post,
} from '@nestjs/common';
import { InviteService } from '../../services/invite.service';

@Controller('internal')
export class InternalInviteController {
	constructor(private readonly inviteService: InviteService) {}

	@Post('invites')
	async inviteUserToRoom(
		@Body() body: {
			username: string;
			roomId?: string;
			sender?: string;
			name: string;
		},
	): Promise<unknown> {
		const { username, roomId, sender, name } = body;
		try {
			return this.inviteService.inviteUserToRoom(
				username,
				roomId,
				sender,
				name,
			);
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				`Failed to invite user: ${error instanceof Error ? error.message : String(error)}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}
}
