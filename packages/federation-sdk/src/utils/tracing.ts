import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { Span, SpanOptions } from '@opentelemetry/api';

/**
 * Options for tracing instance methods
 */
export interface ITraceInstanceMethodsOptions {
	/**
	 * The type prefix for span names (e.g., 'model', 'service', 'handler', 'sdk')
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

	/**
	 * Per-method attribute extractors that pull relevant debugging info from arguments
	 * Key is the method name, value is a function that receives arguments and returns attributes
	 */
	attributeExtractors?: Record<
		string,
		(args: unknown[]) => Record<string, unknown>
	>;
}

/**
 * Sanitize arguments for tracing, filtering out large objects
 */
const sanitizeArguments = (args: unknown[]): unknown[] => {
	return args.map((arg) => {
		// Skip large objects that would bloat traces
		if (typeof arg === 'object' && arg !== null) {
			const keys = Object.keys(arg);
			if (keys.length > 10) {
				return `[object with ${keys.length} keys]`;
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
 * Wraps all methods of an instance with OpenTelemetry tracing spans.
 * This function creates child spans for each method call if there's an active context.
 *
 * @param instance - The object instance to trace
 * @param options - Configuration options for tracing
 * @returns A proxied instance with all methods traced
 *
 * @example
 * // For SDK services:
 * return traceInstanceMethods(this, { type: 'sdk' });
 *
 * @example
 * // For services with custom extractors:
 * return traceInstanceMethods(this, {
 *   type: 'sdk',
 *   attributeExtractors: {
 *     sendMessage: (args) => ({
 *       roomId: args[0],
 *       senderId: args[3],
 *     }),
 *   },
 * });
 */
export function traceInstanceMethods<T extends object>(
	instance: T,
	options: ITraceInstanceMethodsOptions,
): T {
	const {
		type,
		className,
		ignoreMethods = [],
		attributeExtractors = {},
	} = options;

	return new Proxy(instance, {
		get(target, prop: string): unknown {
			const value = (target as Record<string, unknown>)[prop];
			if (typeof value === 'function' && !ignoreMethods.includes(prop)) {
				return new Proxy(value as CallableFunction, {
					apply: (fn, thisArg, argumentsList): unknown => {
						// Skip internal/utility methods
						if (
							[
								'doNotMixInclusionAndExclusionFields',
								'ensureDefaultFields',
							].includes(prop)
						) {
							return Reflect.apply(fn, thisArg, argumentsList);
						}

						// Build attributes: start with base info
						const attributes: Record<string, unknown> = {
							'homeserver-sdk': `${type} ${className}`,
							method: prop,
						};

						// If there's a custom extractor for this method, use it
						if (attributeExtractors[prop]) {
							try {
								const extractedAttrs = attributeExtractors[prop](argumentsList);
								Object.assign(attributes, extractedAttrs);
							} catch {
								// If extractor fails, continue with base attributes
							}
						} else {
							// Fallback to raw parameters for methods without extractors
							attributes.parameters = sanitizeArguments(argumentsList);
						}

						return tracerActiveSpan(
							`homeserver-sdk ${type} ${className}.${prop}`,
							{
								attributes: attributes as Record<
									string,
									string | number | boolean | undefined
								>,
							},
							() => {
								return Reflect.apply(fn, thisArg, argumentsList);
							},
						);
					},
				});
			}

			return Reflect.get(target, prop);
		},
	}) as T;
}

/**
 * Add attributes to the currently active span.
 * Use this inside methods to add runtime information discovered during execution,
 * such as computed values, data fetched from DB, or other contextual info.
 *
 * @param attributes - Key-value pairs to add to the current span
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
export function addSpanAttributes(attributes: Record<string, unknown>): void {
	const span = trace.getActiveSpan();
	if (span) {
		span.setAttributes(
			attributes as Record<string, string | number | boolean | undefined>,
		);
	}
}

/**
 * Check if there's an active tracing context.
 * Useful for conditional logic based on whether tracing is active.
 */
export function hasActiveSpan(): boolean {
	return trace.getActiveSpan() !== undefined;
}
