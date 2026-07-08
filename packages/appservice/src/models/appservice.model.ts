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

export interface AppServiceEphemeralEvent {
	type: string;
	room_id?: string;
	sender?: string;
	content: Record<string, unknown>;
}

export interface AppServiceTransaction {
	_id: string;
	asId: string;
	txnId: number;
	eventIds: string[];
	ephemeralEvents?: AppServiceEphemeralEvent[];
	status: 'pending' | 'sent' | 'failed';
	attempts: number;
	createdAt: Date;
	sentAt?: Date;
	lastAttemptAt?: Date;
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
