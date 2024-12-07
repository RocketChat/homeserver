export function cache<TFunction extends (...args: any[]) => Promise<any>>(
	fn: TFunction,
	timeout: number,
): TFunction {
	let cached: Awaited<ReturnType<TFunction>> | undefined;
	let timestamp = Date.now();

	return (async (...args) => {
		if (Date.now() - timestamp > timeout) {
			timestamp = Date.now();
			cached = undefined;
		}

		if (cached === undefined) {
			cached = await fn(...args);
		}

		return cached;
	}) as TFunction;
}
