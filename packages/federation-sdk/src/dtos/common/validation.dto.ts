import { t } from 'elysia';

export const UsernameDto = t.String({
	pattern: '^@[A-Za-z0-9_=\\/.+-]+:(.+)$',
	description: 'Matrix user ID in format @user:server.com',
	examples: ['@alice:example.com'],
});

export const RoomIdDto = t.String({
	pattern: '^![A-Za-z0-9_=\\/.+-]+:(.+)$',
	description: 'Matrix room ID in format !room:server.com',
	examples: ['!room123:example.com'],
});

export const EventIdDto = t.String({
	pattern: '^\\$[A-Za-z0-9_=\\/.+-]+(:(.+))?$',
	description: 'Matrix event ID in format $event',
	examples: ['$event123:example.com', '$event123'],
});

export const ServerNameDto = t.String({
	description: 'Matrix server name',
	examples: ['example.com'],
});

export const TimestampDto = t.Number({
	description: 'Unix timestamp in milliseconds',
	minimum: 0,
});

export const DepthDto = t.Number({
	description: 'Event depth',
	minimum: 0,
}); 