import { Injectable, Logger } from '@nestjs/common';
import type { MakeJoinResponse, SendJoinResponse, SendTransactionResponse, Transaction } from '../specs/federation-api';
import { FederationEndpoints } from '../specs/federation-api';
import { FederationConfigService } from './federation-config.service';
import { FederationRequestService } from './federation-request.service';
import { SignatureVerificationService } from './signature-verification.service';

@Injectable()
export class FederationService {
  private readonly logger = new Logger(FederationService.name);

  constructor(
    private readonly configService: FederationConfigService,
    private readonly requestService: FederationRequestService,
    private readonly signatureService: SignatureVerificationService,
  ) {}

  /**
   * Get a make_join template for a room and user
   */
  async makeJoin(
    domain: string,
    roomId: string,
    userId: string,
    version?: string,
  ): Promise<MakeJoinResponse> {
    try {
      const uri = FederationEndpoints.makeJoin(roomId, userId);
      const queryParams: Record<string, string> = {};
      
      if (version) {
        queryParams['ver'] = version;
      } else {
        // Support all recent room versions if not specified
        for (let ver = 1; ver <= 11; ver++) {
          queryParams[`ver${ver === 1 ? '' : ver}`] = ver.toString();
        }
      }
      
      return await this.requestService.get<MakeJoinResponse>(domain, uri, queryParams);
    } catch (error: any) {
      this.logger.error(`makeJoin failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send a join event to a remote server
   */
  async sendJoin(
    domain: string,
    roomId: string,
    userId: string,
    joinEvent: any,
    omitMembers = false,
  ): Promise<SendJoinResponse> {
    try {
      // Update join event with origin and timestamp
      const eventWithOrigin = {
        ...joinEvent,
        origin: this.configService.serverName,
        origin_server_ts: Date.now(),
      };
      
      const uri = FederationEndpoints.sendJoinV2(roomId, userId);
      const queryParams = omitMembers ? { 'omit_members': 'true' } : undefined;
      
      return await this.requestService.put<SendJoinResponse>(
        domain, 
        uri, 
        eventWithOrigin, 
        queryParams
      );
    } catch (error: any) {
      this.logger.error(`sendJoin failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send a transaction to a remote server
   */
  async sendTransaction(
    domain: string,
    transaction: Transaction,
  ): Promise<SendTransactionResponse> {
    try {
      const txnId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      const uri = FederationEndpoints.sendTransaction(txnId);
      
      return await this.requestService.put<SendTransactionResponse>(domain, uri, transaction);
    } catch (error: any) {
      this.logger.error(`sendTransaction failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send an event to a remote server
   */
  async sendEvent(domain: string, event: any): Promise<SendTransactionResponse> {
    try {
      const transaction: Transaction = {
        origin: this.configService.serverName,
        origin_server_ts: Date.now(),
        pdus: [event],
      };
      
      return await this.sendTransaction(domain, transaction);
    } catch (error: any) {
      this.logger.error(`sendEvent failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get events from a remote server
   */
  async getEvent(domain: string, eventId: string): Promise<any> {
    try {
      const uri = FederationEndpoints.getEvent(eventId);
      return await this.requestService.get<any>(domain, uri);
    } catch (error: any) {
      this.logger.error(`getEvent failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get state for a room from remote server
   */
  async getState(domain: string, roomId: string, eventId: string): Promise<any> {
    try {
      const uri = FederationEndpoints.getState(roomId);
      const queryParams = { 'event_id': eventId };
      
      return await this.requestService.get<any>(domain, uri, queryParams);
    } catch (error: any) {
      this.logger.error(`getState failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get state IDs for a room from remote server
   */
  async getStateIds(domain: string, roomId: string): Promise<any> {
    try {
      const uri = FederationEndpoints.getStateIds(roomId);
      return await this.requestService.get<any>(domain, uri);
    } catch (error: any) {
      this.logger.error(`getStateIds failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get server version information
   */
  async getVersion(domain: string): Promise<any> {
    try {
      return await this.requestService.get<any>(domain, FederationEndpoints.version);
    } catch (error: any) {
      this.logger.error(`getVersion failed: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Verify PDU from a remote server
   */
  async verifyPDU(event: any, originServer: string): Promise<boolean> {
    return this.signatureService.verifySignature(event, originServer);
  }
} 