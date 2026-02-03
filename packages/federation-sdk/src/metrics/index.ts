import client, { type Registry } from 'prom-client';

let registry: Registry = client.register;

export function initMetrics(opts: { registry: Registry }) {
	registry = opts.registry;
}

const percentiles = [0.01, 0.1, 0.5, 0.9, 0.95, 0.99, 1];

/**
 * Gets an existing metric from the registry or creates it if it doesn't exist.
 * This ensures we don't get duplicate registration errors when the SDK
 * is used alongside other apps that also register metrics.
 */
function getOrCreateMetric<T extends client.Metric>(
	name: string,
	createFn: () => T,
): T {
	const existing = registry.getSingleMetric(name);
	if (existing) {
		return existing as T;
	}
	return createFn();
}

/**
 * Federation metrics for incoming operations.
 */
export const federationMetrics = {
	/** Counter for federation events processed */
	get federationEventsProcessed() {
		return getOrCreateMetric(
			'rocketchat_federation_events_processed',
			() =>
				new client.Counter({
					name: 'rocketchat_federation_events_processed',
					labelNames: ['event_type', 'direction'],
					help: 'Total federation events processed',
					registers: [registry],
				}),
		);
	},

	/** Counter for failed federation events */
	get federationEventsFailed() {
		return getOrCreateMetric(
			'rocketchat_federation_events_failed',
			() =>
				new client.Counter({
					name: 'rocketchat_federation_events_failed',
					labelNames: ['event_type', 'direction', 'error_type'],
					help: 'Total federation events that failed to process',
					registers: [registry],
				}),
		);
	},

	/** Counter for messages received from other federated servers */
	get federatedMessagesReceived() {
		return getOrCreateMetric(
			'rocketchat_federation_messages_received',
			() =>
				new client.Counter({
					name: 'rocketchat_federation_messages_received',
					labelNames: ['message_type', 'origin'],
					help: 'Total federated messages received',
					registers: [registry],
				}),
		);
	},

	/** Counter for rooms joined */
	get federatedRoomsJoined() {
		return getOrCreateMetric(
			'rocketchat_federation_rooms_joined',
			() =>
				new client.Counter({
					name: 'rocketchat_federation_rooms_joined',
					labelNames: ['origin'],
					help: 'Total federated rooms joined',
					registers: [registry],
				}),
		);
	},

	/** Duration to process incoming federation transaction */
	get federationTransactionProcessDuration() {
		return getOrCreateMetric(
			'rocketchat_federation_transaction_process_duration_seconds',
			() =>
				new client.Summary({
					name: 'rocketchat_federation_transaction_process_duration_seconds',
					labelNames: ['pdu_count', 'edu_count', 'origin'],
					help: 'Time to process incoming federation transaction',
					percentiles,
					registers: [registry],
				}),
		);
	},

	/** Duration to process incoming federated message */
	get federationIncomingMessageProcessDuration() {
		return getOrCreateMetric(
			'rocketchat_federation_incoming_message_process_duration_seconds',
			() =>
				new client.Summary({
					name: 'rocketchat_federation_incoming_message_process_duration_seconds',
					labelNames: ['message_type'],
					help: 'Time to process incoming federated message',
					percentiles,
					registers: [registry],
				}),
		);
	},

	/** Duration to join a federated room */
	get federationRoomJoinDuration() {
		return getOrCreateMetric(
			'rocketchat_federation_room_join_duration_seconds',
			() =>
				new client.Summary({
					name: 'rocketchat_federation_room_join_duration_seconds',
					labelNames: ['origin'],
					help: 'Time to join a federated room (invite acceptance)',
					percentiles,
					registers: [registry],
				}),
		);
	},
};
