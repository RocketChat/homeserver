import { createLogger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';
import { StagingAreaQueue } from '../queues/staging-area.queue';
import { StagingAreaService } from '../services/staging-area.service';

@singleton()
export class StagingAreaListener {
	private readonly logger = createLogger('StagingAreaListener');

	constructor(
		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly stagingAreaService: StagingAreaService,
	) {
		this.stagingAreaQueue.registerHandler(this.handleQueueItem.bind(this));
	}

	async handleQueueItem(data: string) {
		this.logger.debug(`Processing event ${data}`);
		await this.stagingAreaService.processEventForRoom(data);
	}
}
