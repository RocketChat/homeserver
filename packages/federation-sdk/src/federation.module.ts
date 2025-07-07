import { FederationConfigService } from './services/federation-config.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';
import { SignatureVerificationService } from './services/signature-verification.service';
import type {
	FederationModuleAsyncOptions,
	FederationModuleOptions,
} from './types';

export class FederationModule {
	static forRootAsync(options: FederationModuleAsyncOptions) {
		return {
			module: FederationModule,
			imports: options.imports || [],
			providers: [
				{
					provide: 'FEDERATION_OPTIONS',
					useFactory: options.useFactory,
					inject: options.inject || [],
				},
				FederationConfigService,
				FederationService,
				SignatureVerificationService,
				FederationRequestService,
			],
			exports: [
				FederationService,
				SignatureVerificationService,
				FederationRequestService,
				FederationConfigService,
			],
		};
	}
}
