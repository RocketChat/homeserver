import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import {
	AsyncDispatcher,
	type EventHandlerOf,
	type EventOf,
	logger,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import type { HomeserverEventSignatures } from '..';
import { federationMetrics } from '../metrics';
import {
	determineMessageType,
	extractOriginFromMatrixRoomId,
	extractOriginFromMatrixUserId,
	getEventTypeLabel,
} from '../metrics/helpers';
import { extractEventEmitterAttributes } from '../utils/tracing';

/**
 * Exception handler type for event handlers.
 * Called when an event handler throws an error, after metrics are recorded.
 * The original error is always re-thrown after this handler completes.
 */
export type EventHandlerExceptionHandler = (
	error: unknown,
	event: string,
	data: unknown,
) => void | Promise<void>;

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
		onError?: EventHandlerExceptionHandler,
	): (data: EventOf<HomeserverEventSignatures, K>) => Promise<unknown> {
		return async (
			data: EventOf<HomeserverEventSignatures, K>,
		): Promise<unknown> => {
			const startTime = Date.now();
			const eventTypeLabel = getEventTypeLabel(event as string);

			// Extract event data for metrics labels
			const eventData = data as Record<string, unknown>;
			const nestedEvent = eventData?.event as
				| Record<string, unknown>
				| undefined;

			try {
				const currentSpan = trace.getSpan(context.active());

				let result: unknown;
				if (currentSpan) {
					result = await this.tracer.startActiveSpan(
						`homeserver-sdk event handler ${event}`,
						{
							attributes: {
								'event.type': event as string,
								'handler.type': handlerType,
							},
						},
						async (span) => {
							try {
								return await (handler as (data: unknown) => unknown)(data);
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
					result = await (handler as (data: unknown) => unknown)(data);
				}

				// Record success metrics
				federationMetrics.federationEventsProcessed.inc({
					event_type: eventTypeLabel,
					direction: 'incoming',
				});

				// Record event-specific metrics
				this.recordEventSpecificMetrics(
					event as string,
					nestedEvent,
					startTime,
				);

				return result;
			} catch (err) {
				// Record failure metrics
				federationMetrics.federationEventsFailed.inc({
					event_type: eventTypeLabel,
					direction: 'incoming',
					error_type: err instanceof Error ? err.constructor.name : 'Unknown',
				});

				// Call optional exception handler if provided
				if (onError) {
					try {
						await onError(err, event as string, data);
					} catch (handlerErr) {
						// Log but don't replace the original error
						logger.error(
							{
								msg: 'Exception handler threw an error',
								event,
								originalError: err,
								handlerError: handlerErr,
							},
							'Exception handler failed',
						);
					}
				}

				throw err;
			}
		};
	}

	/**
	 * Records event-specific metrics based on event type.
	 */
	private recordEventSpecificMetrics(
		event: string,
		nestedEvent: Record<string, unknown> | undefined,
		startTime: number,
	): void {
		const durationSeconds = (Date.now() - startTime) / 1000;

		if (
			event === 'homeserver.matrix.message' ||
			event === 'homeserver.matrix.encrypted'
		) {
			const messageType = determineMessageType(nestedEvent || {});
			const origin = extractOriginFromMatrixUserId(
				String(nestedEvent?.sender || ''),
			);

			federationMetrics.federatedMessagesReceived.inc({
				message_type: messageType,
				origin,
			});

			federationMetrics.federationIncomingMessageProcessDuration.observe(
				{ message_type: messageType },
				durationSeconds,
			);
		}

		if (event === 'homeserver.matrix.membership') {
			const content = nestedEvent?.content as
				| Record<string, unknown>
				| undefined;
			if (content?.membership === 'join') {
				const roomId = String(nestedEvent?.room_id || '');
				const origin = extractOriginFromMatrixRoomId(roomId);

				federationMetrics.federatedRoomsJoined.inc({ origin });
				federationMetrics.federationRoomJoinDuration.observe(
					{ origin },
					durationSeconds,
				);
			}
		}
	}

	/**
	 * Generic subscription method that handles handler wrapping, mapping, and registration.
	 */
	private subscribe<K extends keyof HomeserverEventSignatures>(
		method: 'on' | 'once',
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
		onError?: EventHandlerExceptionHandler,
	): (() => void) | undefined {
		const tracedHandler = this.createTracedHandler(
			event,
			handler,
			method,
			onError,
		);

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
	 *
	 * @param event - The event to subscribe to
	 * @param handler - The handler function to execute when the event is emitted
	 * @param onError - Optional exception handler called when the handler throws.
	 *                  Called after metrics are recorded but before the error is re-thrown.
	 */
	public on<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
		onError?: EventHandlerExceptionHandler,
	): (() => void) | undefined {
		return this.subscribe('on', event, handler, onError);
	}

	/**
	 * Subscribe to an event once with tracing support.
	 * Similar to on(), but automatically unsubscribes after the first event.
	 *
	 * @param event - The event to subscribe to
	 * @param handler - The handler function to execute when the event is emitted
	 * @param onError - Optional exception handler called when the handler throws.
	 *                  Called after metrics are recorded but before the error is re-thrown.
	 */
	public once<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
		onError?: EventHandlerExceptionHandler,
	): (() => void) | undefined {
		return this.subscribe('once', event, handler, onError);
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
