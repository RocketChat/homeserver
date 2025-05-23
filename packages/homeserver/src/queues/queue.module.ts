import { Global, Module } from '@nestjs/common';
import { MissingEventsQueue } from './missing-event.queue';
import { StagingAreaQueue } from './staging-area.queue';

const QUEUES = [
  MissingEventsQueue,
  StagingAreaQueue
];

@Global()
@Module({
  providers: [...QUEUES],
  exports: [...QUEUES],
})
export class QueueModule { }