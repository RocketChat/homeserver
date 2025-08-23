import { ConfigService } from './services/config.service';
import { EduService } from './services/edu.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';
import { InviteService } from './services/invite.service';
import { SignatureVerificationService } from './services/signature-verification.service';

export class FederationModule {
	static forRootAsync(options: Record<string, unknown>) {
		return {
			module: FederationModule,
			imports: options.imports || [],
			providers: [
				ConfigService,
				FederationService,
				SignatureVerificationService,
				FederationRequestService,
				EduService,
				InviteService,
			],
			exports: [
				FederationService,
				SignatureVerificationService,
				FederationRequestService,
				ConfigService,
				EduService,
				InviteService,
			],
		};
	}
}
