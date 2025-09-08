import 'reflect-metadata';
import { logger } from './packages/core/src/utils/logger';
import { appPromise } from './packages/homeserver/src/homeserver.module';

const port = process.env.PORT || 8080;

appPromise.then((app) => {
	app.listen(port, () => {
		logger.info(`🚀 App running on http://localhost:${port}`);
	});
});
