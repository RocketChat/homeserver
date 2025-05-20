import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { KeyService } from "../services/key.service";
import {
	encodeCanonicalJson,
	EncryptionValidAlgorithm,
	verifySignature,
} from "@hs/crypto";

// Implements SPEC: https://spec.matrix.org/v1.12/server-server-api/#request-authentication

@Injectable()
export class AuthHeaderMiddleware implements NestMiddleware {
	constructor(@Inject(KeyService) private readonly keyService: KeyService) {}

	private extractSignaturesFromHeader(authorizationHeader: string) {
		// `X-Matrix origin="${origin}",destination="${destination}",key="${key}",sig="${signed}"`

		const regex = /\b(origin|destination|key|sig)="([^"]+)"/g;
		const {
			origin,
			destination,
			key,
			sig: signature,
			...rest
		} = Object.fromEntries(
			[...authorizationHeader.matchAll(regex)].map(
				([, key, value]) => [key, value] as const,
			),
		);

		if (Object.keys(rest).length) {
			// it should never happen since the regex should match all the parameters
			throw new Error("Invalid authorization header, unexpected parameters");
		}

		if ([origin, destination, key, signature].some((value) => !value)) {
			throw new Error("Invalid authorization header");
		}

		return {
			origin,
			destination,
			key,
			signature,
		};
	}

	async use(req: Request, res: Response, next: NextFunction) {
		// get the key for the server
		// verify the signature of the request
		// can only use verify_keys for this btw
		const { origin, key, destination, signature } =
			this.extractSignaturesFromHeader(req.headers.authorization as string);

		const jsonToSign = {
			method: req.method,
			uri: req.url,
			origin,
			destination,
			content: req.body,
		};

		const verifyKey = await this.keyService.getCurrentVerifyKey(origin, key);

		try {
			verifySignature(
				encodeCanonicalJson(jsonToSign),
				new Uint8Array(Buffer.from(signature, "base64")),
				new Uint8Array(Buffer.from(verifyKey, "base64")),
				{
					algorithm: EncryptionValidAlgorithm.ed25519,
					signingName: origin,
				},
			);
		} catch (error) {
			console.error(error);

			return res.status(403).send("M_FORBIDDEN");
		}

		next();
	}
}
