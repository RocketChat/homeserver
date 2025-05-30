import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import {
	type StagingAreaEventType,
	StagingAreaQueue,
} from '../queues/staging-area.queue';
import { StagingAreaService } from '../services/staging-area.service';

@Injectable()
export class StagingAreaListener {
	private readonly logger = new Logger(StagingAreaListener.name);

	constructor(
		@Inject(forwardRef(() => StagingAreaQueue))
		private readonly stagingAreaQueue: StagingAreaQueue,
		@Inject(forwardRef(() => StagingAreaService))
		private readonly stagingAreaService: StagingAreaService,
	) {
		this.stagingAreaQueue.registerHandler(this.handleQueueItem.bind(this));
	}

	async handleQueueItem(data: StagingAreaEventType) {
		this.logger.debug(`Processing event ${data.eventId} from ${data.origin}`);
		await this.stagingAreaService.processEvent(data);
	}
}
