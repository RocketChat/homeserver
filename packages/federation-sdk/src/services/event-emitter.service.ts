import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import {
	AsyncDispatcher,
	type EventHandlerOf,
	type EventOf,
	logger,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import type { HomeserverEventSignatures } from '..';
import { extractEventEmitterAttributes } from '../utils/tracing';

@singleton()
export class EventEmitterService {
	private emitter: AsyncDispatcher<HomeserverEventSignatures> =
		new AsyncDispatcher<HomeserverEventSignatures>();

	private tracer = trace.getTracer('@rocket.chat/federation-sdk');

	/**
	 * Maps event -> WeakMap<originalHandler, tracedWrapper[]>.
	 * This structure allows:
	 * - Tracking wrappers per event (so same handler on different events doesn't conflict)
	 * - Multiple wrappers per handler (so same handler subscribed multiple times works)
	 * - Deterministic removal (FIFO - first subscribed wrapper is removed first)
	 * Using WeakMap for handler->wrappers to avoid memory leaks when handlers are GC'd.
	 */
	private handlerMap = new Map<
		keyof HomeserverEventSignatures,
		WeakMap<
			// biome-ignore lint/suspicious/noExplicitAny: Handler functions have varying signatures
			(...args: any[]) => any,
			// biome-ignore lint/suspicious/noExplicitAny: Handler functions have varying signatures
			Array<(...args: any[]) => any>
		>
	>();

	/**
	 * Creates a traced handler wrapper that executes the original handler
	 * within a span context for tracing purposes.
	 */
	private createTracedHandler<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
		handlerType: 'on' | 'once',
	): (data: EventOf<HomeserverEventSignatures, K>) => Promise<unknown> {
		return async (
			data: EventOf<HomeserverEventSignatures, K>,
		): Promise<unknown> => {
			const currentSpan = trace.getSpan(context.active());

			// If there's an active span (from emit), create a child span for the handler
			if (currentSpan) {
				return this.tracer.startActiveSpan(
					`homeserver-sdk event handler ${event}`,
					{
						attributes: {
							'event.type': event as string,
							'handler.type': handlerType,
						},
					},
					async (span) => {
						try {
							const result = await (handler as (data: unknown) => unknown)(
								data,
							);
							return result;
						} catch (err) {
							span.recordException(err as Error);
							span.setStatus({
								code: SpanStatusCode.ERROR,
								message: err instanceof Error ? err.message : String(err),
							});
							throw err;
						} finally {
							span.end();
						}
					},
				);
			}

			// No active span, just call the handler directly
			return (handler as (data: unknown) => unknown)(data);
		};
	}

	/**
	 * Generic subscription method that handles handler wrapping, mapping, and registration.
	 */
	private subscribe<K extends keyof HomeserverEventSignatures>(
		method: 'on' | 'once',
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		const tracedHandler = this.createTracedHandler(event, handler, method);

		// Get or create the WeakMap for this event
		let eventHandlers = this.handlerMap.get(event);
		if (!eventHandlers) {
			eventHandlers = new WeakMap();
			this.handlerMap.set(event, eventHandlers);
		}

		// Get or create the array of wrappers for this handler
		let wrappers = eventHandlers.get(handler);
		if (!wrappers) {
			wrappers = [];
			eventHandlers.set(handler, wrappers);
		}

		// Add the new traced wrapper to the array
		wrappers.push(tracedHandler);

		return this.emitter[method](
			event,
			tracedHandler as EventHandlerOf<HomeserverEventSignatures, K>,
		);
	}

	public async emit<K extends keyof HomeserverEventSignatures>(
		event: K,
		...[data]: EventOf<HomeserverEventSignatures, K> extends void
			? [undefined?]
			: [EventOf<HomeserverEventSignatures, K>]
	): Promise<void> {
		const currentSpan = trace.getSpan(context.active());

		// If there's an active span, emit within a traced context
		if (currentSpan) {
			const attributes = extractEventEmitterAttributes(event as string, data);

			await this.tracer.startActiveSpan(
				`homeserver-sdk event emit ${event}`,
				{ attributes },
				async (span) => {
					try {
						// biome-ignore lint/suspicious/noExplicitAny: Complex type inference with event data spreading
						await this.emitter.emit(event, ...([data] as any));
						logger.debug({ msg: `Event emitted: ${event}`, event, data });
					} catch (err) {
						span.recordException(err as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: err instanceof Error ? err.message : String(err),
						});
						throw err;
					} finally {
						span.end();
					}
				},
			);
		} else {
			// No active span, emit without tracing
			// biome-ignore lint/suspicious/noExplicitAny: Complex type inference with event data spreading
			await this.emitter.emit(event, ...([data] as any));
			logger.debug({ msg: `Event emitted: ${event}`, event, data });
		}
	}

	/**
	 * Subscribe to an event with tracing support.
	 * When the event is emitted, the handler will execute within a span
	 * that continues the context, allowing handlers to add attributes
	 * to the span using addSpanAttributes().
	 */
	public on<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		return this.subscribe('on', event, handler);
	}

	/**
	 * Subscribe to an event once with tracing support.
	 * Similar to on(), but automatically unsubscribes after the first event.
	 */
	public once<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		return this.subscribe('once', event, handler);
	}

	public off<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): void {
		// Look up the event's handler map
		const eventHandlers = this.handlerMap.get(event);
		if (!eventHandlers) {
			// Fallback: try with the original handler in case it was registered directly
			this.emitter.off(event, handler);
			return;
		}

		// Look up the wrappers for this handler
		const wrappers = eventHandlers.get(handler);
		if (!wrappers || wrappers.length === 0) {
			// Fallback: try with the original handler in case it was registered directly
			this.emitter.off(event, handler);
			return;
		}

		// Remove the first wrapper (FIFO - first subscribed is first removed)
		const wrappedHandler = wrappers.shift();
		if (wrappedHandler) {
			this.emitter.off(
				event,
				wrappedHandler as EventHandlerOf<HomeserverEventSignatures, K>,
			);
		}

		// Clean up empty arrays from the WeakMap
		if (wrappers.length === 0) {
			eventHandlers.delete(handler);
		}

		// Note: We don't remove empty WeakMaps from handlerMap since we can't
		// check if a WeakMap is empty. This is fine since event keys are finite.
	}
}
