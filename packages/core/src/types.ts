import { Pdu } from '@rocket.chat/federation-room';
import type { EventID } from '@rocket.chat/federation-room';

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

export type KeyV2ServerResponse = {
	// still valid for signing events
	old_verify_keys: Record<
		string,
		{
			expired_ts: number;
			key: string;
		}
	>;
	server_name: string;
	signatures: Record<string, Record<string, string>>;
	valid_until_ts: number;
	// only federation requests
	verify_keys: Record<
		string, // keyAlgo:algoVersion => KeyId
		{
			key: string; // base64 encoded
		}
	>;
};

export type ServerKey = {
	serverName: string;
	keyId: string;
	key: string;
	pem: string;

	_createdAt: Date;
	_updatedAt: Date;
	expiresAt: Date;
};
