import { Injectable, Logger } from '@nestjs/common';
import * as nacl from 'tweetnacl';

interface KeyData {
  server_name: string;
  verify_keys: {
    [keyId: string]: {
      key: string;
    };
  };
  old_verify_keys?: {
    [keyId: string]: {
      key: string;
      expired_ts: number;
    };
  };
}

@Injectable()
export class SignatureVerificationService {
  private readonly logger = new Logger(SignatureVerificationService.name);
  private cachedKeys = new Map<string, KeyData>();

  /**
   * Verify a signature from a remote server
   */
  async verifySignature(
    event: any, 
    originServer: string,
    getPublicKeyFn?: (origin: string, keyId: string) => Promise<string>,
  ): Promise<boolean> {
    try {
      if (!event.signatures || !event.signatures[originServer]) {
        this.logger.warn(`No signature found for ${originServer}`);
        return false;
      }

      // Extract the signing key ID and signature
      const signatureObj = event.signatures[originServer];
      const keyId = Object.keys(signatureObj)[0];
      const signature = signatureObj[keyId];

      if (!keyId || !signature) {
        this.logger.warn(`Invalid signature data for ${originServer}`);
        return false;
      }

      // Get public key - either from cache, or using the provided function
      let publicKey: string;
      
      if (getPublicKeyFn) {
        // Use provided function to fetch the key
        publicKey = await getPublicKeyFn(originServer, keyId);
      } else {
        // Use cached key or fetch from key server
        const keyData = await this.getOrFetchPublicKey(originServer, keyId);
        if (!keyData || !keyData.verify_keys[keyId]) {
          this.logger.warn(`Public key not found for ${originServer}:${keyId}`);
          return false;
        }
        publicKey = keyData.verify_keys[keyId].key;
      }

      // Create a copy of the event without the signatures for verification
      const eventToVerify = { ...event };
      delete eventToVerify.signatures;
      delete eventToVerify.unsigned;

      // Convert to canonical JSON
      const canonicalJson = JSON.stringify(eventToVerify);
      
      // Verify signature
      const publicKeyUint8 = Buffer.from(publicKey, 'base64');
      const signatureUint8 = Buffer.from(signature, 'base64');
      
      return nacl.sign.detached.verify(
        Buffer.from(canonicalJson),
        signatureUint8,
        publicKeyUint8,
      );
    } catch (error: any) {
      this.logger.error(`Error verifying signature: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Get public key from cache or fetch it from the server
   */
  private async getOrFetchPublicKey(serverName: string, keyId: string): Promise<KeyData | null> {
    const cacheKey = `${serverName}:${keyId}`;
    
    if (this.cachedKeys.has(cacheKey)) {
      return this.cachedKeys.get(cacheKey)!;
    }
    
    try {
      // Fetch key from server
      const response = await fetch(`https://${serverName}/_matrix/key/v2/server`);
      
      if (!response.ok) {
        this.logger.error(`Failed to fetch keys from ${serverName}: ${response.status}`);
        return null;
      }
      
      const keyData = await response.json() as KeyData;
      
      // Cache the key data
      this.cachedKeys.set(cacheKey, keyData);
      
      return keyData;
    } catch (error: any) {
      this.logger.error(`Error fetching public key: ${error.message}`, error.stack);
      return null;
    }
  }
} 