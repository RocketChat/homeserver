import {
	AsyncDispatcher,
	type EventHandlerOf,
	type EventOf,
	logger,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';

import { Emitter } from '@rocket.chat/emitter';
import type { HomeserverEventSignatures } from '..';
import { extractEventEmitterAttributes } from '../utils/tracing-attributes';

@singleton()
export class EventEmitterService {
	private emitter: AsyncDispatcher<HomeserverEventSignatures> =
		new AsyncDispatcher<HomeserverEventSignatures>();

	private tracer = trace.getTracer('@rocket.chat/federation-sdk');

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
		// Create a wrapped handler that executes within the traced context
		const tracedHandler = async (
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
							'handler.type': 'on',
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

		return this.emitter.on(
			event,
			tracedHandler as EventHandlerOf<HomeserverEventSignatures, K>,
		);
	}

	/**
	 * Subscribe to an event once with tracing support.
	 * Similar to on(), but automatically unsubscribes after the first event.
	 */
	public once<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): (() => void) | undefined {
		// Create a wrapped handler that executes within the traced context
		const tracedHandler = async (
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
							'handler.type': 'once',
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

		return this.emitter.once(
			event,
			tracedHandler as EventHandlerOf<HomeserverEventSignatures, K>,
		);
	}

	public off<K extends keyof HomeserverEventSignatures>(
		event: K,
		handler: EventHandlerOf<HomeserverEventSignatures, K>,
	): void {
		this.emitter.off(event, handler);
	}
}
