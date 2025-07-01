import type { EventBase } from './events/eventBase';

export enum EncryptionValidAlgorithm {
	ed25519 = 'ed25519',
}

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

export type SigningKey = {
	algorithm: EncryptionValidAlgorithm;
	version: string;
	privateKey: Uint8Array;
	publicKey: Uint8Array;
	sign(data: Uint8Array): Promise<Uint8Array>;
};
