import { EventStagingStore, EventStore, ServerKey } from '@hs/core';
import { db } from './config.service.spec';
import { KeyRepository } from '../repositories/key.repository';
import { Lock, LockRepository } from '../repositories/lock.repository';
import { EventStagingRepository } from '../repositories/event-staging.repository';
import { StateStore, StateRepository } from '../repositories/state.repository';
import { EventRepository } from '../repositories/event.repository';

const keysCollection = db.collection<ServerKey>('test_keys');
const eventsCollection = db.collection<EventStore>('test_events');
const eventStagingCollection =
	db.collection<EventStagingStore>('test_event_staging');
const lockCollection = db.collection<Lock>('test_locks');
const statesCollection = db.collection<StateStore>('test_states');

export const collections = {
	keys: keysCollection,
	events: eventsCollection,
	eventsStaging: eventStagingCollection,
	locks: lockCollection,
	states: statesCollection,
};

const keyRepository = new KeyRepository(keysCollection);

const eventStagingRepository = new EventStagingRepository(
	eventStagingCollection,
);
const lockRepository = new LockRepository(lockCollection);
const stateRepository = new StateRepository(statesCollection as any); // TODO: fix this

const eventsRepository = new EventRepository(eventsCollection);

export const repositories = {
	keys: keyRepository,
	locks: lockRepository,
	eventStaging: eventStagingRepository,
	states: stateRepository,
	events: eventsRepository,
};
