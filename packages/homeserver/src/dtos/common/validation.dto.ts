import { t } from 'elysia';

export const UsernameDto = t.String({
	pattern: '^@[A-Za-z0-9_=\\/.+-]+:(.+)$',
	description: 'Matrix user ID in format @user:server.com',
	examples: ['@alice:example.com'],
});

export const RoomIdDto = t.String({
	pattern: '^!(?:[A-Za-z0-9_=\\/.+-]+:(.+)|[A-Za-z0-9_-]{43})$',
	description: 'Matrix room ID in format !room:server.com, or from room v12 !<create event hash>',
	examples: ['!room123:example.com', '!31hneApxJ_1o-63DmFrpeqnkFfWppnzWso1JvH3ogLM'],
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
