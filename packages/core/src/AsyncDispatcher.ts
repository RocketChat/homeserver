/** @public */
export type DefaultEventMap = Record<string | symbol, any>;

/** @public */
export type AnyEventTypeOf<EventMap extends DefaultEventMap> = keyof EventMap;

/** @public */
export type AnyEventOf<EventMap extends DefaultEventMap> = EventMap[keyof EventMap];

/** @public */
export type AnyEventHandlerOf<EventMap extends DefaultEventMap> = {
	[EventType in keyof EventMap]: EventMap[EventType] extends void
		? () => unknown | Promise<unknown>
		: (event: EventMap[EventType]) => unknown | Promise<unknown>;
}[keyof EventMap];

/** @public */
export type EventTypeOf<EventMap extends DefaultEventMap, EventValue extends EventMap[keyof EventMap]> = {
	[EventType in keyof EventMap]: EventMap[EventType] extends EventValue ? EventType : never;
}[keyof EventMap];

/** @public */
export type EventOf<EventMap extends DefaultEventMap, EventType extends AnyEventTypeOf<EventMap>> = EventMap[EventType] extends void
	? never
	: EventMap[EventType];

/** @public */
export type EventHandlerOf<EventMap extends DefaultEventMap, EventType extends AnyEventTypeOf<EventMap>> = EventMap[EventType] extends void
	? () => unknown | Promise<unknown>
	: (event: EventMap[EventType]) => unknown | Promise<unknown>;

/** @public */
export type OffCallbackHandler = () => void;

/** @public */
export interface IAsyncDispatcher<EventMap extends DefaultEventMap = DefaultEventMap> {
	on<T extends AnyEventOf<EventMap>, EventType extends AnyEventTypeOf<EventMap> = EventTypeOf<EventMap, T>>(
		type: EventType,
		handler: EventHandlerOf<EventMap, EventType>,
	): OffCallbackHandler;
	once<T extends AnyEventOf<EventMap>, EventType extends AnyEventTypeOf<EventMap> = EventTypeOf<EventMap, T>>(
		type: EventType,
		handler: EventHandlerOf<EventMap, EventType>,
	): OffCallbackHandler;
	off<T extends AnyEventOf<EventMap>, EventType extends AnyEventTypeOf<EventMap> = EventTypeOf<EventMap, T>>(
		type: EventType,
		handler: EventHandlerOf<EventMap, EventType>,
	): void;

	has(key: AnyEventTypeOf<EventMap>): boolean;
	events(): AnyEventTypeOf<EventMap>[];

	emit<T extends AnyEventOf<EventMap>, EventType extends AnyEventTypeOf<EventMap> = EventTypeOf<EventMap, T>>(
		type: EventType,
		...[event]: EventOf<EventMap, EventType> extends void ? [undefined?] : [EventOf<EventMap, EventType>]
	): Promise<void>;
}

const kOnce = Symbol('once');
const kEvents = Symbol('events');

/**
 * Fully async event dispatcher.
 *
 * Handlers may be sync or async, but dispatch always awaits them.
 *
 * @public
 */
export class AsyncDispatcher<EventMap extends DefaultEventMap = DefaultEventMap> implements IAsyncDispatcher<EventMap> {
	private [kEvents] = new Map<AnyEventTypeOf<EventMap>, AnyEventHandlerOf<EventMap>[]>();

	private [kOnce] = new WeakMap<AnyEventHandlerOf<EventMap>, number>();

	events(): AnyEventTypeOf<EventMap>[] {
		return Array.from(this[kEvents].keys());
	}

	has(key: AnyEventTypeOf<EventMap>): boolean {
		return this[kEvents].has(key);
	}

	on(type: keyof EventMap, handler: (...args: any[]) => unknown) {
		const handlers = this[kEvents].get(type) ?? [];
		handlers.push(handler);
		this[kEvents].set(type, handlers);
		return () => this.off(type, handler);
	}

	once(type: keyof EventMap, handler: (...args: any[]) => unknown) {
		const count = this[kOnce].get(handler) || 0;
		this[kOnce].set(handler, count + 1);
		return this.on(type, handler);
	}

	off(type: keyof EventMap, handler: (...args: any[]) => unknown) {
		const handlers = this[kEvents].get(type);
		if (!handlers) return;

		const count = this[kOnce].get(handler) ?? 0;
		if (count > 1) {
			this[kOnce].set(handler, count - 1);
		} else {
			this[kOnce].delete(handler);
		}

		const idx = handlers.findIndex((h) => h === handler);
		if (idx !== -1) handlers.splice(idx, 1);

		if (handlers.length === 0) {
			this[kEvents].delete(type);
		}
	}

	async emit(type: keyof EventMap, ...[event]: any[]): Promise<void> {
		const list = [...(this[kEvents].get(type) ?? [])];

		for await (const handler of list) {
			await handler(event);

			if (this[kOnce].get(handler)) {
				this.off(type, handler);
			}
		}
	}
}
