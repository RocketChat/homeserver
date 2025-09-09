import { ConfigService } from './services/config.service';
import { EduService } from './services/edu.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';
import { InviteService } from './services/invite.service';

export class FederationModule {
	static forRootAsync(options: Record<string, unknown>) {
		return {
			module: FederationModule,
			imports: options.imports || [],
			providers: [
				ConfigService,
				FederationService,
				FederationRequestService,
				EduService,
				InviteService,
			],
			exports: [
				FederationService,
				FederationRequestService,
				ConfigService,
				EduService,
				InviteService,
			],
		};
	}
}
