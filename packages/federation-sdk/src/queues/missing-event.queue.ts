import { singleton } from 'tsyringe';
import { BaseQueue } from './base.queue';

export type MissingEventType = {
	eventId: string;
	roomId: string;
	origin: string;
};

@singleton()
export class MissingEventsQueue extends BaseQueue<MissingEventType> {}
