import 'reflect-metadata';
import { appPromise } from './packages/homeserver/src/homeserver.module';
import logger from './packages/homeserver/src/utils/logger';

appPromise.then((app) => {
	app.listen(8080, () => {
		logger.info('🚀 App running on http://localhost:8080');
	});
});
