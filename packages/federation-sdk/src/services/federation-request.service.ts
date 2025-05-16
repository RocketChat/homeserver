import { Injectable, Logger } from '@nestjs/common';
import * as nacl from 'tweetnacl';
import { authorizationHeaders, computeAndMergeHash } from '../../../homeserver/src/authentication';
import { resolveHostAddressByServerName } from '../../../homeserver/src/helpers/server-discovery/discovery';
import { extractURIfromURL } from '../../../homeserver/src/helpers/url';
import { signJson } from '../../../homeserver/src/signJson';
import { FederationConfigService } from './federation-config.service';

interface SignedRequest {
  method: string;
  domain: string;
  uri: string;
  body?: any;
  queryString?: string;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

@Injectable()
export class FederationRequestService {
  private readonly logger = new Logger(FederationRequestService.name);

  constructor(private readonly configService: FederationConfigService) {}

  async makeSignedRequest<T>({
    method,
    domain,
    uri,
    body,
    queryString,
  }: SignedRequest): Promise<T> {
    try {
      const serverName = this.configService.serverName;
      const signingKeyBase64 = this.configService.signingKey;
      const signingKeyId = this.configService.signingKeyId;
      
      // Create signing key object for request signing
      const privateKeyBytes = Buffer.from(signingKeyBase64, 'base64');
      const keyPair = nacl.sign.keyPair.fromSecretKey(privateKeyBytes);
      
      const signingKey = {
        algorithm: 'ed25519',
        version: signingKeyId.split(':')[1] || '1',
        privateKey: keyPair.secretKey,
        publicKey: keyPair.publicKey,
        sign: async (data: Uint8Array) => nacl.sign.detached(data, keyPair.secretKey)
      };
      
      // Prepare request URL
      let url: URL;
      let address: string;
      let headers: Record<string, string> = {};
      
      try {
        const result = await resolveHostAddressByServerName(domain, serverName);
        address = result.address;
        headers = result.headers || {};
      } catch (error) {
        // Fallback to direct domain if discovery fails
        this.logger.warn(`Server discovery failed for ${domain}, using direct domain`);
        address = domain;
      }
      
      const fullUri = uri + (queryString ? `?${queryString}` : '');
      url = new URL(`https://${address}${fullUri}`);
      
      this.logger.debug(`Making ${method} request to ${url.toString()}`);

      // Sign the body if present
      let signedBody: any;
      try {
        if (body) {
          signedBody = await signJson(
            computeAndMergeHash({ ...body, signatures: {} }),
            signingKey as any,
            serverName
          );
        }
      } catch (signError: any) {
        this.logger.error(`Error signing request: ${signError.message}`);
        throw new Error(`Failed to sign request: ${signError.message}`);
      }
      
      // Create authorization header
      let auth: string;
      try {
        auth = await authorizationHeaders(
          serverName,
          signingKey as any,
          domain,
          method,
          extractURIfromURL(url),
          signedBody as any
        );
      } catch (authError: any) {
        this.logger.error(`Error generating authorization headers: ${authError.message}`);
        throw new Error(`Failed to generate authorization headers: ${authError.message}`);
      }
      
      // Send the request
      const requestHeaders = {
        'Authorization': auth,
        'Content-Type': 'application/json',
        ...headers
      };

      const requestOptions: RequestInit = {
        method,
        headers: requestHeaders,
        body: signedBody ? JSON.stringify(signedBody) : undefined,
      };

      const response = await fetch(url.toString(), requestOptions);
      
      if (!response.ok) {
        let errorText: string;
        try {
          errorText = await response.text();
          const errorObj = JSON.parse(errorText);
          errorText = JSON.stringify(errorObj);
        } catch (e) {
          // If parsing fails, use the raw text
          errorText = await response.text();
        }
        throw new Error(`Federation request failed: ${response.status} ${errorText}`);
      }
      
      const responseText = await response.text();
      try {
        return JSON.parse(responseText) as T;
      } catch (parseError) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
    } catch (error: any) {
      this.logger.error(`Federation request failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  async request<T>(method: HttpMethod, targetServer: string, endpoint: string, body?: any, queryParams?: Record<string, string>): Promise<T> {
    let queryString = '';
    
    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        params.append(key, value);
      }
      queryString = params.toString();
    }
    
    return this.makeSignedRequest<T>({
      method,
      domain: targetServer,
      uri: endpoint,
      body,
      queryString
    });
  }

  async get<T>(targetServer: string, endpoint: string, queryParams?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', targetServer, endpoint, undefined, queryParams);
  }
  
  async put<T>(targetServer: string, endpoint: string, body: any, queryParams?: Record<string, string>): Promise<T> {
    return this.request<T>('PUT', targetServer, endpoint, body, queryParams);
  }
  
  async post<T>(targetServer: string, endpoint: string, body: any, queryParams?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', targetServer, endpoint, body, queryParams);
  }
} 