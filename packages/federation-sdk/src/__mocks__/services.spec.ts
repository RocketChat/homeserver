import { StagingAreaQueue } from '../queues/staging-area.queue';
import { AppConfig, ConfigService } from '../services/config.service';
import { EventEmitterService } from '../services/event-emitter.service';
import { EventService } from '../services/event.service';
import { KeyService } from '../services/key.service';
import { SignatureVerificationService } from '../services/signature-verification.service';
import { StateService } from '../services/state.service';
import { repositories } from './repositories.spec';

const configService = new ConfigService();

configService.setConfig({
	signingKey: 'ed25519 0 zSkmr713LnEDbxlkYq2ZqIiKTQNsyMOU0T2CEeC44C4',
	serverName: 'test.local',
} as AppConfig);

const keyService = new KeyService(configService, repositories.keys);

const stagingAreaQueue = new StagingAreaQueue();

const stateService = new StateService(
	repositories.states,
	repositories.events,
	configService,
);

const eventEmitter = new EventEmitterService();

const signatureVerificationService = new SignatureVerificationService(
	keyService,
);

const eventService = new EventService(
	configService,
	stagingAreaQueue,
	stateService,
	eventEmitter,
	keyService,
	signatureVerificationService,
	repositories.events,
	repositories.eventStaging,
	repositories.locks,
);

export {
	keyService,
	stateService,
	stagingAreaQueue,
	eventEmitter,
	signatureVerificationService,
	eventService,
};
