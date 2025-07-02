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
}