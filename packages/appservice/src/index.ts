import 'reflect-metadata';

import type { Collection, Db } from 'mongodb';
import { container } from 'tsyringe';

import type { AppServiceRegistration, AppServiceState, AppServiceTransaction } from './models/appservice.model';
import { BridgeQueryService } from './services/bridge-query.service';
import { EventRouterService } from './services/event-router.service';
import { NamespaceGuardService } from './services/namespace-guard.service';
import { NamespaceMatcherService } from './services/namespace-matcher.service';
import { PingService } from './services/ping.service';
import { RegistrationService } from './services/registration.service';
import { TransactionSenderService } from './services/transaction-sender.service';

export type {
	AppServiceRegistration,
	AppServiceRegistrationYaml,
	AppServiceNamespaces,
	AppServiceState,
	AppServiceTransaction,
	CachedAppService,
	CompiledNamespace,
	Namespace,
} from './models/appservice.model';

export { AppServiceRepository } from './repositories/appservice.repository';
export { AppServiceStateRepository } from './repositories/appservice-state.repository';
export { AppServiceTransactionRepository } from './repositories/appservice-txn.repository';

export { RegistrationService } from './services/registration.service';
export { NamespaceMatcherService } from './services/namespace-matcher.service';
export { TransactionSenderService } from './services/transaction-sender.service';
export { EventRouterService } from './services/event-router.service';
export { BridgeQueryService } from './services/bridge-query.service';
export { PingService, type PingResult, type PingError } from './services/ping.service';
export { NamespaceGuardService } from './services/namespace-guard.service';

/**
 * Initialize the appservice package: register MongoDB collections in the
 * DI container and load any existing registrations from the database.
 */
export async function initAppService(db: Db): Promise<void> {
	container.register<Collection<AppServiceRegistration>>('AppServiceCollection', {
		useValue: db.collection<AppServiceRegistration>('rocketchat_appservices'),
	});

	container.register<Collection<AppServiceState>>('AppServiceStateCollection', {
		useValue: db.collection<AppServiceState>('rocketchat_appservices_state'),
	});

	container.register<Collection<AppServiceTransaction>>('AppServiceTxnCollection', {
		useValue: db.collection<AppServiceTransaction>('rocketchat_appservices_txns'),
	});

	// Create indexes
	const appserviceCol = db.collection<AppServiceRegistration>('rocketchat_appservices');
	await appserviceCol.createIndex({ asToken: 1 }, { unique: true });

	const txnCol = db.collection<AppServiceTransaction>('rocketchat_appservices_txns');
	await txnCol.createIndex({ asId: 1, txnId: 1 }, { unique: true });
	await txnCol.createIndex({ asId: 1, status: 1 });

	// Load existing registrations into cache
	const registrationService = container.resolve(RegistrationService);
	await registrationService.initialize();
}

/**
 * Resolve the main appservice services from the DI container.
 * Call after initAppService().
 */
export function resolveAppServices() {
	return {
		registrationService: container.resolve(RegistrationService),
		namespaceMatcher: container.resolve(NamespaceMatcherService),
		transactionSender: container.resolve(TransactionSenderService),
		eventRouter: container.resolve(EventRouterService),
		bridgeQuery: container.resolve(BridgeQueryService),
		ping: container.resolve(PingService),
		namespaceGuard: container.resolve(NamespaceGuardService),
	};
}
