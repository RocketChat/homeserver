import type Elysia from "elysia";

type ExtractElysiaRoutes<T> = T extends Elysia<any, any, any, any, any, infer S>
	? S
	: never;

type ConcatRoutes<
	R extends Record<string, any> = Record<string, any>,
	P extends string = "",
	K extends keyof R = keyof R,
> = K extends string
	? R[K] extends { response: infer G }
		? { method: Uppercase<K>; path: `${P}`; response: G }
		: K extends `:${string}`
			? ConcatRoutes<R[K], `${P}/${string}`, keyof R[K]>
			: ConcatRoutes<R[K], `${P}/${K}`, keyof R[K]>
	: K;

export type ElysiaRoutes<T extends Elysia<any, any, any, any, any, any>> =
	ConcatRoutes<ExtractElysiaRoutes<T>>;

// organize by method
export type ElysiaRoutesResponsesByEndpoint<T extends ElysiaRoutes<any>> =
	T extends {
		response: infer R;
		method: infer M;
		path: infer P;
	}
		? {
				[K in T["method"]]: T["response"];
			}
		: never;
