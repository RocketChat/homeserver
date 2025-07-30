import { ConfigService } from './services/config.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';
import { SignatureVerificationService } from './services/signature-verification.service';

export class FederationModule {
	static forRootAsync(options: any) {
		return {
			module: FederationModule,
			imports: options.imports || [],
			providers: [
				ConfigService,
				FederationService,
				SignatureVerificationService,
				FederationRequestService,
			],
			exports: [
				FederationService,
				SignatureVerificationService,
				FederationRequestService,
				ConfigService,
			],
		};
	}
}
