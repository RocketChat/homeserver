import 'reflect-metadata';
import { appPromise } from './packages/homeserver/src/homeserver.module';
import { createLogger } from './packages/core/src/utils/logger';

const logger = createLogger('app');

appPromise.then((app) => {
	app.listen(8080, () => {
		logger.info('🚀 App running on http://localhost:8080');
	});
});
