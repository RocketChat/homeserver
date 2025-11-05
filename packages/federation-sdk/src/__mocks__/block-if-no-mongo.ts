export function runIfMongoExists(t: () => void) {
	if (!process.env.RUN_MONGO_TESTS) {
		console.warn('Skipping tests that require a database');
		return;
	}

	t();
}
