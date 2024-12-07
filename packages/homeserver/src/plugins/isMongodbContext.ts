import type { Context } from "./mongodb";

export const isMongodbContext = <T extends object>(
	context: T,
): context is T & Context => "mongo" in context;
