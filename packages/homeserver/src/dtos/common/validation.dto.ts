import { z } from 'zod';

export const UsernameDto = z.string()
	.regex(/^@[A-Za-z0-9_=\/.+-]+:(.+)$/)
	.describe('Matrix user ID in format @user:server.com');

export const RoomIdDto = z.string()
	.regex(/^![A-Za-z0-9_=\/.+-]+:(.+)$/)
	.describe('Matrix room ID in format !room:server.com');

export const EventIdDto = z.string()
	.regex(/^\$[A-Za-z0-9_=\/.+-]+(:(.+))?$/)
	.describe('Matrix event ID in format $event');

export const ServerNameDto = z.string()
	.describe('Matrix server name');

export const TimestampDto = z.number()
	.min(0)
	.describe('Unix timestamp in milliseconds');

export const DepthDto = z.number()
	.min(0)
	.describe('Event depth'); 