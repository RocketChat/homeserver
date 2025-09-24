import {
	Emitter,
	type EventHandlerOf,
	type EventOf,
} from '@rocket.chat/emitter';
import { logger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import type { HomeserverEventSignatures } from '..';

@singleton()
export class EventEmitterService {
	private emitter: Emitter<HomeserverEventSignatures> =
		new Emitter<HomeserverEventSignatures>();

	public setEmitter(emitter: Emitter<HomeserverEventSignatures>): void {
		this.emitter = emitter;
		logger.info('EventEmitterService: External emitter injected');
	}

	public initializeStandalone(): void {
		this.emitter = new Emitter<HomeserverEventSignatures>();
		logger.info('EventEmitterService: Standalone emitter initialized');
	}

	public emit<K extends keyof HomeserverEventSignatures>(
		event: K,
		...[data]: EventOf<HomeserverEventSignatures, K> extends void
			? [undefined?]
			: [EventOf<HomeserverEventSignatures, K>]
	): void {
		this.emitter.emit(event, ...([data] as any));
		logger.debug(`Event emitted: ${event}`, { event, data });
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

	public off<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): void {
		this.emitter.off(event, handler);
	}

	public getEmitter(): Emitter<HomeserverEventSignatures> {
		return this.emitter;
	}
}
