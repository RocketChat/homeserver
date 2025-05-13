import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { StagingAreaEventType, StagingAreaQueue } from '../queues/staging-area.queue';
import { StagingAreaService } from '../services/staging-area.service';
import { Logger } from '../utils/logger';

@Injectable()
export class StagingAreaListener {
  private readonly logger = new Logger('StagingAreaListener');
  
  constructor(
    @Inject(forwardRef(() => StagingAreaQueue)) private readonly stagingAreaQueue: StagingAreaQueue,
    @Inject(forwardRef(() => StagingAreaService)) private readonly stagingAreaService: StagingAreaService,
  ) {
    this.stagingAreaQueue.registerHandler(this.handleQueueItem.bind(this));
  }

  async handleQueueItem(data: StagingAreaEventType & { metadata?: any }) {
    this.logger.debug(`Processing event ${data.eventId} from ${data.origin}`);
    
    await this.stagingAreaService.processEvent(data);
  }
}