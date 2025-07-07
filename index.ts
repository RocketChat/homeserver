import 'reflect-metadata';
import { logger } from './packages/core/src/utils/logger';
import { appPromise } from './packages/homeserver/src/homeserver.module';

appPromise.then((app) => {
	app.listen(8080, () => {
		logger.info('🚀 App running on http://localhost:8080');
	});
});
