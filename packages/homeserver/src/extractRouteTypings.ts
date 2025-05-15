import type Elysia from "elysia";

type ExtractElysiaRoutes<T> = T extends Elysia<unknown, unknown, unknown, unknown, unknown, infer S>
	? S
	: never;

type ConcatRoutes<
	R extends Record<string, unknown> = Record<string, unknown>,
	P extends string = "",
	K extends keyof R = keyof R,
> = K extends string
	? R[K] extends { response: infer G; body: infer B }
		? { method: Uppercase<K>; path: `${P}`; response: G; body: B }
		: K extends `:${string}`
			? ConcatRoutes<R[K], `${P}/${string}`, keyof R[K]>
			: ConcatRoutes<R[K], `${P}/${K}`, keyof R[K]>
	: K;

export type ElysiaRoutes<T extends Elysia<unknown, unknown, unknown, unknown, unknown, unknown>> =
	ConcatRoutes<ExtractElysiaRoutes<T>>;
