import { Elysia } from 'elysia';
import { InternalPingResponseDto } from '../../dtos/internal/ping.dto';

export const pingPlugin = (app: Elysia) =>
	app.get(
		'/internal/ping',
		() => {
			return 'PONG!';
		},
		{
			response: {
				200: InternalPingResponseDto,
			},
			detail: {
				tags: ['Internal'],
				summary: 'Health check endpoint',
				description: 'Simple ping endpoint to check if the server is running',
			},
		},
	);
