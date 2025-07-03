import { createLogger } from '@hs/core';
import type { StagingAreaEventType } from '@hs/federation-sdk';
import { StagingAreaQueue } from '@hs/federation-sdk';
import { StagingAreaService } from '@hs/federation-sdk';
import { injectable } from 'tsyringe';

@injectable()
export class StagingAreaListener {
	private readonly logger = createLogger('StagingAreaListener');

	constructor(
		private readonly stagingAreaQueue: StagingAreaQueue,
		private readonly stagingAreaService: StagingAreaService,
	) {
		this.stagingAreaQueue.registerHandler(this.handleQueueItem.bind(this));
	}

	async handleQueueItem(data: StagingAreaEventType) {
		this.logger.debug(`Processing event ${data.eventId} from ${data.origin}`);
		await this.stagingAreaService.processEvent(data);
	}
}
