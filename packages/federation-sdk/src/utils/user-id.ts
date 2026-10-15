import type { UserID } from '@rocket.chat/federation-room';

// https://spec.matrix.org/v1.16/appendices/#server-name
const SERVER_NAME = '(?:\\[[0-9A-Fa-f:.]{2,45}\\]|[0-9A-Za-z.-]{1,255})(?::[0-9]{1,5})?';

// https://spec.matrix.org/v1.16/appendices/#user-identifiers, historical localparts included
const USER_ID_REGEX = new RegExp(`^@[\\x21-\\x39\\x3B-\\x7E]+:${SERVER_NAME}$`);

const MAX_USER_ID_LENGTH = 255;

export function isUserId(value: string): value is UserID {
	return value.length <= MAX_USER_ID_LENGTH && USER_ID_REGEX.test(value);
}
