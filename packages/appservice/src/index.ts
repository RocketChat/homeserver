import 'reflect-metadata';

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

export { APPSERVICE_CONFIG_PROVIDER, type AppServiceConfigProvider } from './config-provider';
