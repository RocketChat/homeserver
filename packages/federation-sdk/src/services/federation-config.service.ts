import { Inject, Injectable } from '@nestjs/common';
import type { FederationModuleOptions } from '../federation.module';

@Injectable()
export class FederationConfigService {
	constructor(
		@Inject('FEDERATION_OPTIONS')
		private readonly options: FederationModuleOptions,
	) {}

	get serverName(): string {
		return this.options.serverName;
	}

	get signingKey(): string {
		return this.options.signingKey;
	}

	get signingKeyId(): string {
		return this.options.signingKeyId || 'ed25519:1';
	}

	get timeout(): number {
		return this.options.timeout || 30000; // Default 30 seconds
	}

	get baseUrl(): string | undefined {
		return this.options.baseUrl;
	}
}
