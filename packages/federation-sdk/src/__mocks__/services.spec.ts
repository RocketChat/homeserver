import { StagingAreaQueue } from '../queues/staging-area.queue';
import { EventEmitterService } from '../services/event-emitter.service';
import { EventService } from '../services/event.service';
import { KeyService } from '../services/key.service';
import { SignatureVerificationService } from '../services/signature-verification.service';
import { StateService } from '../services/state.service';
import { config } from './config.service.spec';
import { repositories } from './repositories.spec';

const keyService = new KeyService(config, repositories.keys);

const stagingAreaQueue = new StagingAreaQueue();

const stateService = new StateService(
	repositories.states,
	repositories.events,
	config,
);

const eventEmitter = new EventEmitterService();

const signatureVerificationService = new SignatureVerificationService();

const eventService = new EventService(
	repositories.events,
	repositories.eventStaging,
	repositories.locks,
	config,
	stagingAreaQueue,
	stateService,
	eventEmitter,
	keyService,
	signatureVerificationService,
);

export {
	keyService,
	stateService,
	stagingAreaQueue,
	eventEmitter,
	signatureVerificationService,
	eventService,
};
