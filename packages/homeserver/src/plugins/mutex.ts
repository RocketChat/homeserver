import Elysia, { type InferContext } from "elysia";
import { Mutex } from "../mutex/Mutex";

export const routerWithMutex = new Elysia().decorate("mutex", new Mutex());

export const isMutexContext = <T extends object>(
	context: T,
): context is T & Context => "mutex" in context;

type Context = InferContext<typeof routerWithMutex>;
