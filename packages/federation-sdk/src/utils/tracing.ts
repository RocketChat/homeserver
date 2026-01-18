import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { Span, SpanOptions } from '@opentelemetry/api';

/**
 * Symbol key used to store the attribute extractor on methods
 */
export const TRACE_EXTRACTOR_KEY = Symbol('traceExtractor');

/**
 * Type for the extractor function stored on decorated methods
 */
export type TraceExtractor<TArgs extends unknown[] = unknown[]> = (
	...args: TArgs
) => Record<string, unknown>;

/**
 * Interface for methods that have a trace extractor attached
 */
// biome-ignore lint/complexity/noBannedTypes: Function type needed for method interface
export interface ITracedMethod extends Function {
	[TRACE_EXTRACTOR_KEY]?: TraceExtractor;
}

/**
 * Decorator that attaches an attribute extractor to a method for tracing.
 * The extractor receives the method arguments and returns attributes to add to the span.
 *
 * Use this decorator on methods to define inline attribute extraction that
 * will be picked up by `@tracedClass`.
 *
 * @param extractor - Function that extracts trace attributes from method arguments
 *
 * @example
 * @tracedClass({ type: 'service' })
 * class FederationMatrix {
 *   @traced((room: IRoom, owner: IUser) => ({
 *     roomId: room?._id,
 *     roomName: room?.name || room?.fname,
 *     ownerId: owner?._id,
 *   }))
 *   async createRoom(room: IRoom, owner: IUser) {
 *     // method implementation
 *   }
 * }
 */
export function traced<TArgs extends unknown[]>(
	extractor: (...args: TArgs) => Record<string, unknown>,
): MethodDecorator {
	return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
		const originalMethod = descriptor.value as ITracedMethod;
		if (originalMethod) {
			originalMethod[TRACE_EXTRACTOR_KEY] = extractor as TraceExtractor;
		}
		return descriptor;
	};
}

/**
 * Get the trace extractor from a method, if one was attached via @traced decorator.
 */
function getTraceExtractor(method: unknown): TraceExtractor | undefined {
	if (typeof method === 'function') {
		return (method as ITracedMethod)[TRACE_EXTRACTOR_KEY];
	}
	return undefined;
}

/**
 * Options for @tracedClass decorator
 */
export interface ITracedClassOptions {
	/**
	 * The type prefix for span names (e.g., 'model', 'service', 'handler')
	 */
	type: string;

	/**
	 * The class name to use in span names. Required because minification
	 * mangles constructor.name.
	 */
	className: string;

	/**
	 * Array of method names to exclude from tracing
	 */
	ignoreMethods?: string[];
}

/**
 * Sanitize arguments for tracing, filtering out large objects and mongo sessions
 */
const sanitizeArguments = (args: unknown[]): unknown[] => {
	return args.map((arg) => {
		// Filter out mongo sessions
		if (typeof arg === 'object' && arg != null && 'session' in arg) {
			return '[mongo options with session]';
		}
		// For large objects, include first 10 keys and indicate more were skipped
		if (typeof arg === 'object' && arg !== null) {
			const keys = Object.keys(arg);
			if (keys.length > 10) {
				const limitedObject: Record<string, unknown> = {};
				// Include first 10 keys
				for (let i = 0; i < 10; i++) {
					limitedObject[keys[i]] = (arg as Record<string, unknown>)[keys[i]];
				}
				// Add indicator that more keys were skipped
				const skippedKeysKey = '_skipped_keys';
				limitedObject[skippedKeysKey] = keys.length - 10;
				return limitedObject;
			}
		}
		return arg;
	});
};

/**
 * Execute a function within a traced span if there's an active context.
 * This ensures SDK spans are children of the calling application's spans.
 *
 * @param name - The name of the span
 * @param options - Span options including attributes
 * @param fn - The function to execute
 * @returns The result of the function
 */
export function tracerActiveSpan<F extends (span?: Span) => ReturnType<F>>(
	name: string,
	options: SpanOptions,
	fn: F,
): ReturnType<F> {
	const tracer = trace.getTracer('@rocket.chat/federation-sdk');
	const currentSpan = trace.getSpan(context.active());

	// If there's no active span, just execute the function without tracing
	if (!currentSpan) {
		return fn();
	}

	const computeResult = (span: Span) => {
		try {
			const result = fn(span);
			if (result instanceof Promise) {
				result
					.catch((err: unknown) => {
						span.recordException(err as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: err instanceof Error ? err.message : String(err),
						});
					})
					.finally(() => span.end());

				return result;
			}

			span.end();
			return result;
		} catch (err: unknown) {
			span.recordException(err as Error);
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : String(err),
			});
			span.end();
			throw err;
		}
	};

	return tracer.startActiveSpan(name, options, computeResult);
}

/**
 * Class decorator that automatically wraps all methods with OpenTelemetry tracing spans.
 * This decorator wraps methods at the prototype level, making it compatible with
 * dependency injection frameworks like tsyringe.
 *
 * @param options - Configuration options for tracing
 *
 * @example
 * @tracedClass({ type: 'service', className: 'MyService' })
 * class FederationMatrix extends ServiceClass {
 *   @traced((room: IRoom, owner: IUser) => ({ roomId: room?._id }))
 *   async createRoom(room: IRoom, owner: IUser) { ... }
 * }
 *
 * @example
 * @tracedClass({ type: 'repository', className: 'UsersRaw' })
 * class UsersRaw extends BaseRaw<IUser> { ... }
 */
export function tracedClass(
	options: ITracedClassOptions,
	// biome-ignore lint/complexity/noBannedTypes: Function type needed for class decorator
): <TFunction extends Function>(target: TFunction) => TFunction {
	const { type, className, ignoreMethods = [] } = options;

	// biome-ignore lint/complexity/noBannedTypes: Function type needed for class decorator
	return <TFunction extends Function>(target: TFunction): TFunction => {
		const prototype = target.prototype;

		// Get methods from entire prototype chain (excluding Object.prototype)
		let proto = prototype;
		const methodNames = new Set<string>();
		while (proto && proto !== Object.prototype) {
			for (const name of Object.getOwnPropertyNames(proto)) {
				if (
					name !== 'constructor' &&
					typeof proto[name] === 'function' &&
					!ignoreMethods.includes(name)
				) {
					methodNames.add(name);
				}
			}
			proto = Object.getPrototypeOf(proto);
		}

		// Wrap each method with tracing
		for (const methodName of methodNames) {
			const originalMethod = prototype[methodName];

			prototype[methodName] = function (
				this: unknown,
				...args: unknown[]
			): unknown {
				const attributes: Record<string, unknown> = {
					[type]: className,
					method: methodName,
				};

				// Check for @traced decorator extractor
				const extractor = getTraceExtractor(originalMethod);

				if (extractor) {
					try {
						const extractedAttrs = extractor(...args);
						Object.assign(attributes, extractedAttrs);
					} catch {
						// If extractor fails, continue with base attributes
					}
				} else {
					attributes.parameters = sanitizeArguments(args);
				}

				return tracerActiveSpan(
					`homeserver-sdk ${type} ${className}.${methodName}`,
					{
						attributes: attributes as Record<
							string,
							string | number | boolean | undefined
						>,
					},
					() => {
						return originalMethod.apply(this, args);
					},
				);
			};

			// Preserve the original method's name and any attached metadata (like @traced extractors)
			Object.defineProperty(prototype[methodName], 'name', {
				value: methodName,
			});

			// Copy over the trace extractor if it exists
			const extractor = getTraceExtractor(originalMethod);
			if (extractor) {
				(prototype[methodName] as ITracedMethod)[TRACE_EXTRACTOR_KEY] =
					extractor;
			}
		}

		return target;
	};
}

/**
 * Add attributes to the currently active span.
 * Use this inside methods to add runtime information discovered during execution,
 * such as computed values, data fetched from DB, or other contextual info.
 *
 * @param attributes - Key-value pairs to add to the current span (string, number, boolean, or undefined values only)
 *
 * @example
 * async sendMessage(roomId, message, ...) {
 *   const event = await this.stateService.buildEvent(...);
 *
 *   // Add runtime info after we have it
 *   addSpanAttributes({
 *     eventId: event.eventId,
 *     eventType: event.type,
 *   });
 * }
 */
export function addSpanAttributes(
	attributes: Record<string, string | number | boolean | undefined>,
): void {
	const span = trace.getActiveSpan();
	if (span) {
		span.setAttributes(attributes);
	}
}

/**
 * Check if there's an active tracing context.
 * Useful for conditional logic based on whether tracing is active.
 */
export function hasActiveSpan(): boolean {
	return trace.getActiveSpan() !== undefined;
}

/**
 * Extract attributes from event emitter event data based on event type.
 * This function extracts relevant debugging information from event payloads
 * to add as span attributes when events are emitted.
 *
 * @param eventType - The event type being emitted (e.g., 'homeserver.matrix.message')
 * @param data - The event data payload
 * @returns Record of attributes to add to the span
 */
export function extractEventEmitterAttributes(
	eventType: string,
	data: unknown,
): Record<string, string | number | boolean | undefined> {
	const attributes: Record<string, string | number | boolean | undefined> = {
		'event.type': eventType,
	};

	if (!data || typeof data !== 'object') {
		return attributes;
	}

	const eventData = data as Record<string, unknown>;

	// Extract common fields that appear in most events
	if ('event_id' in eventData && typeof eventData.event_id === 'string') {
		attributes['event.id'] = eventData.event_id;
	}

	if ('room_id' in eventData && typeof eventData.room_id === 'string') {
		attributes['room.id'] = eventData.room_id;
	}

	if ('user_id' in eventData && typeof eventData.user_id === 'string') {
		attributes['user.id'] = eventData.user_id;
	}

	if ('sender_id' in eventData && typeof eventData.sender_id === 'string') {
		attributes['sender.id'] = eventData.sender_id;
	}

	// Extract nested event data if present
	if (
		'event' in eventData &&
		typeof eventData.event === 'object' &&
		eventData.event !== null
	) {
		const nestedEvent = eventData.event as Record<string, unknown>;

		if ('room_id' in nestedEvent && typeof nestedEvent.room_id === 'string') {
			attributes['room.id'] = nestedEvent.room_id;
		}

		if ('sender' in nestedEvent && typeof nestedEvent.sender === 'string') {
			attributes['sender.id'] = nestedEvent.sender;
		}

		if ('type' in nestedEvent && typeof nestedEvent.type === 'string') {
			attributes['matrix.event.type'] = nestedEvent.type;
		}

		if (
			'state_key' in nestedEvent &&
			typeof nestedEvent.state_key === 'string'
		) {
			attributes['state.key'] = nestedEvent.state_key;
		}
	}

	// Event-specific attribute extraction
	switch (eventType) {
		case 'homeserver.matrix.typing':
			if ('typing' in eventData && typeof eventData.typing === 'boolean') {
				attributes.typing = eventData.typing;
			}
			if ('origin' in eventData && typeof eventData.origin === 'string') {
				attributes.origin = eventData.origin;
			}
			break;

		case 'homeserver.matrix.presence':
			if ('presence' in eventData && typeof eventData.presence === 'string') {
				attributes['presence.state'] = eventData.presence;
			}
			if (
				'last_active_ago' in eventData &&
				typeof eventData.last_active_ago === 'number'
			) {
				attributes['presence.last_active_ago'] = eventData.last_active_ago;
			}
			if ('origin' in eventData && typeof eventData.origin === 'string') {
				attributes.origin = eventData.origin;
			}
			break;

		case 'homeserver.matrix.room.role':
			if ('role' in eventData && typeof eventData.role === 'string') {
				attributes.role = eventData.role;
			}
			break;

		case 'homeserver.ping':
			if ('message' in eventData && typeof eventData.message === 'string') {
				attributes['ping.message'] = eventData.message;
			}
			break;
	}

	return attributes;
}
