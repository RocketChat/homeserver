import { singleton } from 'tsyringe';
import { BaseQueue } from './base.queue';

export type MissingEventType = {
	eventId: string;
	roomId: string;
	// TODO: check what to do with origin
	origin: string;
};

@singleton()
export class MissingEventsQueue extends BaseQueue<MissingEventType> {}
