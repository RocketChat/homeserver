import { Injectable } from '@nestjs/common';
import { BaseQueue } from './base.queue';

export type MissingEventType = {
	eventId: string;
	roomId: string;
	origin: string;
};

@Injectable()
export class MissingEventsQueue extends BaseQueue<MissingEventType> {}
