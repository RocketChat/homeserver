import type { EventBase } from './events/eventBase';

export type SignedEvent<T extends EventBase> = T & {
	event_id: string;
	hashes: {
		sha256: string;
	};
	signatures: {
		[key: string]: {
			[key: string]: string;
		};
	};
};
