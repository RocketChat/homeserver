import type { Pdu, EventID } from '@rocket.chat/federation-room';

export enum EncryptionValidAlgorithm {
	ed25519 = 'ed25519',
}

export type SignedEvent<T extends Pdu> = T & {
	event_id: EventID;
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
