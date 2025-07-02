import type { Membership } from '@hs/core';

export type HomeserverEventSignatures = {
	'homeserver.ping': {
		message: string;
	};
	'homeserver.matrix.message': {
		event_id: string;
		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			body: string;
			msgtype: string;
		};
	};
	'homeserver.matrix.accept-invite': {
		event_id: string;
		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: { avatar_url: string | null, displayname: string, membership: Membership };
	};
}