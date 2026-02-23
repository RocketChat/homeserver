import type { EventStagingStore } from '@rocket.chat/federation-core';
import type { EventStore } from '@rocket.chat/federation-room';
import type { Collection } from 'mongodb';
import { container } from 'tsyringe';

import { StagingAreaListener } from './listeners/staging-area.listener';
import type { Key } from './repositories/key.repository';
import type { Lock } from './repositories/lock.repository';
import type { Room } from './repositories/room.repository';
import type { Server } from './repositories/server.repository';
import type { StateGraphStore } from './repositories/state-graph.repository';
import type { Upload } from './repositories/upload.repository';
import { DatabaseConnectionService } from './services/database-connection.service';
// import { EventService } from './services/event.service';

export async function init({
	dbConfig,
}: {
	dbConfig: {
		uri: string;
		poolSize: number;
	};
}) {
	const dbConnection = new DatabaseConnectionService(dbConfig);
	const db = await dbConnection.getDb();

	container.register<Collection<EventStore>>('EventCollection', {
		useValue: db.collection<EventStore>('rocketchat_federation_events'),
	});

	container.register<Collection<EventStagingStore>>('EventStagingCollection', {
		useValue: db.collection<EventStagingStore>('rocketchat_federation_events_staging'),
	});

	container.register<Collection<Key>>('KeyCollection', {
		useValue: db.collection<Key>('rocketchat_federation_keys'),
	});

	container.register<Collection<Lock>>('LockCollection', {
		useValue: db.collection<Lock>('rocketchat_federation_locks'),
	});

	container.register<Collection<Room>>('RoomCollection', {
		useValue: db.collection<Room>('rocketchat_federation_rooms'),
	});

	container.register<Collection<Server>>('ServerCollection', {
		useValue: db.collection<Server>('rocketchat_federation_servers'),
	});

	container.register<Collection<Upload>>('UploadCollection', {
		useValue: db.collection<Upload>('rocketchat_uploads'),
	});

	container.register<Collection<StateGraphStore>>('StateGraphCollection', {
		useValue: db.collection<StateGraphStore>('rocketchat_federation_state_graphs'),
	});
	// this is required to initialize the listener and register the queue handler
	container.resolve(StagingAreaListener);

	// once the db is initialized we look for old staged events and try to process them
	// setTimeout(async () => {
	// 	const eventService = container.resolve(EventService);
	// 	await eventService.processOldStagedEvents();
	// }, 5000);
}
