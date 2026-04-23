export interface AppServiceRegistration {
	_id: string;
	url: string | null;
	asToken: string;
	hsToken: string;
	senderLocalpart: string;
	namespaces: AppServiceNamespaces;
	protocols: string[];
	rateLimited: boolean;
	receiveEphemeral: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface AppServiceNamespaces {
	users: Namespace[];
	aliases: Namespace[];
	rooms: Namespace[];
}

export interface Namespace {
	regex: string;
	exclusive: boolean;
}

export interface AppServiceState {
	_id: string;
	state: 'up' | 'down';
	lastTxnId: number;
	streamOrdering: number;
	readReceiptStreamId: number;
	presenceStreamId: number;
	toDeviceStreamId: number;
	lastError?: string;
	lastErrorAt?: Date;
	updatedAt: Date;
}

export interface AppServiceTransaction {
	_id: string;
	asId: string;
	txnId: number;
	eventIds: string[];
	ephemeralEvents?: Record<string, unknown>[];
	status: 'pending' | 'sent' | 'failed';
	attempts: number;
	createdAt: Date;
	sentAt?: Date;
}

/**
 * YAML registration file format as defined by the Matrix spec.
 * Used for parsing bridge registration files for backward compatibility.
 */
export interface AppServiceRegistrationYaml {
	'id': string;
	'url'?: string | null;
	'as_token': string;
	'hs_token': string;
	'sender_localpart': string;
	'namespaces'?: {
		users?: { regex: string; exclusive?: boolean }[];
		aliases?: { regex: string; exclusive?: boolean }[];
		rooms?: { regex: string; exclusive?: boolean }[];
	};
	'protocols'?: string[];
	'rate_limited'?: boolean;
	'de.sorunome.msc2409.push_ephemeral'?: boolean;
	'org.matrix.msc3202'?: boolean;
}

/**
 * In-memory cached version of a registration with compiled regexes.
 */
export interface CachedAppService {
	registration: AppServiceRegistration;
	compiledNamespaces: {
		users: CompiledNamespace[];
		aliases: CompiledNamespace[];
		rooms: CompiledNamespace[];
	};
}

export interface CompiledNamespace {
	regex: RegExp;
	exclusive: boolean;
}
