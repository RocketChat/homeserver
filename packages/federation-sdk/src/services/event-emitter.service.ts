import { Emitter } from '@rocket.chat/emitter';
import { AsyncDispatcher, type EventHandlerOf, type EventOf, logger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import type { HomeserverEventSignatures } from '..';

@singleton()
export class EventEmitterService {
	private emitter: AsyncDispatcher<HomeserverEventSignatures> = new AsyncDispatcher<HomeserverEventSignatures>();

	public async emit<K extends keyof HomeserverEventSignatures>(
		event: K,
		...[data]: EventOf<HomeserverEventSignatures, K> extends void ? [undefined?] : [EventOf<HomeserverEventSignatures, K>]
	): Promise<void> {
		await this.emitter.emit(event, ...([data] as any));
		logger.debug({ msg: `Event emitted: ${event}`, event, data });
	}

	public on<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		return this.emitter.on(event, handler);
	}

	public once<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		return this.emitter.once(event, handler);
	}

	public off<K extends keyof HomeserverEventSignatures>(event: K, handler: EventHandlerOf<HomeserverEventSignatures, K>): void {
		this.emitter.off(event, handler);
	}
}
