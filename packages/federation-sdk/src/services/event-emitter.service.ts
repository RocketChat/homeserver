import {
	AsyncDispatcher,
	type EventHandlerOf,
	type EventOf,
	logger,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { Emitter } from '@rocket.chat/emitter';
import type { HomeserverEventSignatures } from '..';

@singleton()
export class EventEmitterService {
	private emitter: AsyncDispatcher<HomeserverEventSignatures> =
		new AsyncDispatcher<HomeserverEventSignatures>();
	private oldEmitter: Emitter<HomeserverEventSignatures> =
		new Emitter<HomeserverEventSignatures>();

	public setEmitter(emitter: Emitter<HomeserverEventSignatures>): void {
		this.oldEmitter = emitter;
		logger.info('EventEmitterService: External emitter injected');
	}

	public async emit<K extends keyof HomeserverEventSignatures>(
		event: K,
		...[data]: EventOf<HomeserverEventSignatures, K> extends void
			? [undefined?]
			: [EventOf<HomeserverEventSignatures, K>]
	): Promise<void> {
		await this.emitter.emit(event, ...([data] as any));
		if (this.oldEmitter) {
			await this.oldEmitter.emit(event, ...([data] as any));
		}
		logger.debug({ msg: `Event emitted: ${event}`, event, data });
	}

	public on<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		const [handler1, handler2] = [
			this.emitter.on(event, handler),
			this.oldEmitter.on(event, handler),
		];
		return () => {
			handler1();
			handler2();
		};
	}

	public once<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		const [handler1, handler2] = [
			this.emitter.once(event, handler),
			this.oldEmitter.once(event, handler),
		];
		return () => {
			handler1();
			handler2();
		};
	}

	public off<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): void {
		this.emitter.off(event, handler);

		this.oldEmitter.off(event, handler);
	}
}
