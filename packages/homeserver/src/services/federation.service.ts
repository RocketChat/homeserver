import type { EventBase as CoreEventBase } from "@hs/core/src/events/eventBase";
import { Inject, Injectable } from "@nestjs/common";
import { FederationClient } from "../../../federation-sdk/src";
import type { SignedEvent } from "../signEvent";
import { Logger } from "../utils/logger";
import { ConfigService } from "./config.service";

@Injectable()
export class FederationService {
	private readonly logger = new Logger("FederationService");
	private federationClient: FederationClient | null = null;

	constructor(
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {
    this.initFederationClient().catch(err => {
      this.logger.error(`Failed to initialize federation client: ${err.message}`);
    });
  }

	private async initFederationClient() {
		if (this.federationClient) return; // Avoid re-initialization

		try {
			const signingKeys = await this.configService.getSigningKey();
			// Assuming getSigningKey returns SigningKey[] or SigningKey defined in ../keys
			const signingKey = Array.isArray(signingKeys)
				? signingKeys[0]
				: signingKeys;

			if (!signingKey) {
				throw new Error("Signing key not found or configured.");
			}

			this.federationClient = new FederationClient({
				serverName: this.configService.getServerName(),
				signingKey: signingKey, // Pass the SigningKey object
				debug: this.configService.isDebugEnabled(),
			});
			this.logger.debug("Federation client initialized.");
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.logger.error(
				`Failed to initialize federation client: ${errorMessage}`,
			);
			this.federationClient = null; // Ensure client is null on failure
			throw error;
		}
	}

	// Updated method to accept target servers and use FederationClient
	async sendEventToServers(
		roomId: string,
		event: SignedEvent<CoreEventBase>,
		targetServers: string[],
	): Promise<void> {
		if (!this.federationClient) {
			this.logger.warn(
				"Federation client not initialized. Attempting to initialize now...",
			);
			try {
				await this.initFederationClient();
				if (!this.federationClient) {
					throw new Error("Federation client initialization failed.");
				}
			} catch (initError: any) {
				this.logger.error(
					`Cannot send event ${event.event_id}: Federation client unavailable. Error: ${initError.message}`,
				);
				return; // Stop if client cannot be initialized
			}
		}

		const eventId = event.event_id;
		this.logger.debug(
			`Attempting to federate event ${eventId} for room ${roomId} to servers: ${targetServers.join(", ")}`,
		);

		for (const server of targetServers) {
			try {
				this.logger.debug(`Sending event ${eventId} to ${server}...`);
				// Pass the SignedEvent directly to federationClient.sendEvent (which accepts any)
				const response = await this.federationClient.sendEvent(server, event);
				this.logger.debug(
					`Successfully sent event ${eventId} to ${server}. Response: ${JSON.stringify(response)}`,
				);
			} catch (error: any) {
				this.logger.error(`Failed to send event ${eventId} to server ${server}: ${error.message}`);
				// Decide if we should continue sending to other servers or stop
			}
		}

		this.logger.debug(
			`Finished attempting to federate event ${eventId} to specified servers.`,
		);
	}
}
