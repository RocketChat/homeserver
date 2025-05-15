import type {
  MakeJoinResponse,
  SendJoinResponse,
  SendTransactionResponse,
  State,
  StateIds,
  Transaction,
  Version
} from './specs/federation-api';
import { FederationEndpoints } from './specs/federation-api';

import { authorizationHeaders, computeAndMergeHash } from '../../homeserver/src/authentication';
import { resolveHostAddressByServerName } from '../../homeserver/src/helpers/server-discovery/discovery';
import { extractURIfromURL } from '../../homeserver/src/helpers/url';
import type { SigningKey } from '../../homeserver/src/keys';
import { signJson } from '../../homeserver/src/signJson';

export interface FederationClientConfig {
  serverName: string;
  signingKey: SigningKey;
  debug?: boolean;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export class FederationClient {
  private serverName: string;
  private signingKey: SigningKey;
  private debug: boolean;
  
  constructor(config: FederationClientConfig) {
    this.serverName = config.serverName;
    this.signingKey = config.signingKey;
    this.debug = config.debug || false;
  }
  
  private async sendRequest<T>(
    method: HttpMethod,
    targetServer: string,
    uri: string,
    body?: unknown
  ): Promise<T> {
    try {
      const { address, headers } = await resolveHostAddressByServerName(
        targetServer,
        this.serverName
      );
      
      const url = new URL(`https://${address}${uri}`);
      
      if (this.debug) {
        console.log(`[FederationClient] Making ${method} request to ${url.toString()}`);
      }
      
      // Verify signing key has the required structure
      if (!this.signingKey || typeof this.signingKey.sign !== 'function') {
        const keyProps = this.signingKey ? Object.keys(this.signingKey).join(', ') : 'none';
        throw new Error(`Invalid signing key configuration: Missing 'sign' method. Available properties: ${keyProps}`);
      }
      
      let signedBody: unknown;
      try {
        signedBody = body ? 
          await signJson(
            computeAndMergeHash({ ...body, signatures: {} }),
            this.signingKey,
            this.serverName
          ) : undefined;
      } catch (signError) {
        if (this.debug) {
          console.error(`[FederationClient] Error signing request: ${signError.message}`);
        }
        throw new Error(`Failed to sign request: ${signError.message}`);
      }
      
      let auth: string;
      try {
        auth = await authorizationHeaders(
          this.serverName,
          this.signingKey,
          targetServer,
          method,
          extractURIfromURL(url),
          signedBody
        );
      } catch (authError) {
        if (this.debug) {
          console.error(`[FederationClient] Error generating authorization headers: ${authError.message}`);
        }
        throw new Error(`Failed to generate authorization headers: ${authError.message}`);
      }
      
      const response = await fetch(url.toString(), {
        method,
        ...(signedBody && { body: JSON.stringify(signedBody) }),
        headers: {
          Authorization: auth,
          ...headers
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Federation request failed with status ${response.status}`;
        
        try {
          const errorObj = JSON.parse(errorText);
          errorMessage += `: ${JSON.stringify(errorObj)}`;
        } catch (parseError) {
          errorMessage += `: ${errorText}`;
        }
        
        throw new Error(errorMessage);
      }
      
      const responseText = await response.text();
      try {
        return JSON.parse(responseText) as T;
      } catch (parseError) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
    } catch (error) {
      if (this.debug) {
        console.error(`[FederationClient] Request failed: ${error.message}`);
      }
      throw error;
    }
  }
  
  async getVersion(targetServer: string): Promise<Version> {
    return this.sendRequest<Version>(
      'GET',
      targetServer,
      FederationEndpoints.version
    );
  }
  
  async getStateIds(targetServer: string, roomId: string): Promise<StateIds> {
    return this.sendRequest<StateIds>(
      'GET',
      targetServer,
      FederationEndpoints.getStateIds(roomId)
    );
  }
  
  async getState(targetServer: string, roomId: string, eventType?: string, stateKey?: string, eventId?: string): Promise<State> {
    let uri = FederationEndpoints.getState(roomId);

    const params = new URLSearchParams();
    
    if (eventId) {
      params.append('event_id', eventId);
    }
    
    if (eventType) {
      params.append('event_type', eventType);
    }
    
    if (stateKey !== undefined) {
      params.append('state_key', stateKey);
    }
    
    const queryString = params.toString();
    if (queryString) {
      uri += `?${queryString}`;
    }
    
    return this.sendRequest<State>(
      'GET',
      targetServer,
      uri
    );
  }
  
  async getEvent(targetServer: string, eventId: string): Promise<unknown> {
    return this.sendRequest<unknown>(
      'GET',
      targetServer,
      FederationEndpoints.getEvent(eventId)
    );
  }
  
  async makeJoin(targetServer: string, roomId: string, userId: string): Promise<MakeJoinResponse> {
    const uri = `${FederationEndpoints.makeJoin(roomId, userId)}?ver=1&ver=2&ver=3&ver=4&ver=5&ver=6&ver=7&ver=8&ver=9&ver=10&ver=11`;
    
    return this.sendRequest<MakeJoinResponse>(
      'GET',
      targetServer,
      uri
    );
  }
  
  async sendJoin(targetServer: string, roomId: string, eventId: string, joinEvent: unknown): Promise<SendJoinResponse> {
    return this.sendRequest<SendJoinResponse>(
      'PUT',
      targetServer,
      FederationEndpoints.sendJoinV2(roomId, eventId),
      joinEvent
    );
  }
  
  async sendTransaction(targetServer: string, transaction: Transaction): Promise<SendTransactionResponse> {
    const txnId = Date.now().toString();
    
    return this.sendRequest<SendTransactionResponse>(
      'PUT',
      targetServer,
      FederationEndpoints.sendTransaction(txnId),
      transaction
    );
  }
  
  async sendEvent(targetServer: string, event: unknown): Promise<SendTransactionResponse> {
    const transaction: Transaction = {
      origin: this.serverName,
      origin_server_ts: Date.now(),
      pdus: [event]
    };
    
    return this.sendTransaction(targetServer, transaction);
  }
  
  async getUserDevices(targetServer: string, userId: string): Promise<unknown> {
    return this.sendRequest<unknown>(
      'GET',
      targetServer,
      FederationEndpoints.userDevices(userId)
    );
  }
  
  async queryProfile(targetServer: string, userId: string): Promise<any> {
    const uri = `${FederationEndpoints.queryProfile(userId)}?user_id=${encodeURIComponent(userId)}`;
    
    return this.sendRequest<any>(
      'GET',
      targetServer,
      uri
    );
  }
} 