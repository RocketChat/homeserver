import type { Context } from "./config";

export const isConfigContext = <T extends object>(
	context: T,
): context is T & Context => "config" in context;
