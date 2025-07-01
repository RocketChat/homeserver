import 'reflect-metadata';
import { appPromise } from './homeserver.module';
import { logger } from '@hs/core';

appPromise.then((app) => {
	app.listen(8080, () => {
		logger.info('🚀 App running on http://localhost:8080');
	});
});
