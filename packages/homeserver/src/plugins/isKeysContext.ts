import type { Context } from "./keys";

export const isKeysContext = <T extends object>(
	context: T,
): context is T & Context => "keys" in context;

