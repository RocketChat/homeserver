import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import validateHeaderSignature from '../plugins/validateHeaderSignature';
import { KeyService } from '../services/key.service';
import { validateAuthorizationHeader } from '../authentication';
@Injectable()
export class AuthHeaderMiddleware implements NestMiddleware {
	constructor(@Inject(KeyService) private readonly keyService: KeyService) {
	}
	
	private extractSignaturesFromHeader (authorizationHeader: string) {
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
};

  async use(req: Request, res: Response, next: NextFunction) {
	  // get the key for the server
	  // verify the signature of the request
	  // can only use verify_keys for this btw
	  const { origin, key, destination, signature } = this.extractSignaturesFromHeader(req.headers['x-matrix'] as string);

	  const verifyKey = await this.keyService.getCurrentVerifyKey(origin, key);

	  await validateAuthorizationHeader(origin, verifyKey, destination, req.method, req.url, signature, req.body);
	  
	  // TODO: throw forbidden error

    next();
  }
} 
