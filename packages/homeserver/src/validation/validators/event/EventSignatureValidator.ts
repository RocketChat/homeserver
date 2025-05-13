import { createValidator } from '../../Validator';
import { success, failure } from '../../ValidationResult';
import { CanonicalizedEvent } from '../EventValidators';
import { Logger } from '../../../routes/federation/logger';
import { extractOrigin } from '../../../utils/extractOrigin';
import { EncryptionValidAlgorithm } from '../../../signJson';
import { makeGetPublicKeyFromServerProcedure, getPublicKeyFromRemoteServer } from '../../../procedures/getPublicKeyFromServer';
import nacl from 'tweetnacl';
import { getValidPublicKeyFromLocal, storePublicKey } from '../../../utils/keyStore';
import { getServerName } from '../../../utils/serverConfig';

const logger = new Logger("EventSignatureValidator");

/**
 * Validates the event signatures
 * 
 * Matrix events are cryptographically signed by their originating servers.
 * This validator verifies the cryptographic signatures match the canonical form.
 * 
 * Prerequisites:
 * - CanonicalizeEvent must have run first to provide canonicalJson
 */
export const validateEventSignature = createValidator<CanonicalizedEvent>(async (event, _, eventId) => {
  try {
    if (!event.canonicalizedEvent.canonicalJson) {
      logger.warn(`Event ${eventId} missing canonicalJson from CanonicalizeEvent validator`);
      return failure('M_MISSING_CANONICAL_JSON', 'Event missing canonicalJson');
    }
    
    if (!event.event.signatures) {
      logger.warn(`Event ${eventId} missing signatures`);
      return failure('M_MISSING_SIGNATURES', 'Event is missing required signatures');
    }
    
    const serverName = extractOrigin(event.event.sender);
    const serverSignatures = event.event.signatures[serverName];
    if (!serverSignatures || Object.keys(serverSignatures).length === 0) {
      logger.warn(`Missing/empty signatures from origin server ${serverName}`);
      return failure('M_INVALID_SIGNATURE', `Event is missing signature from origin server ${serverName}`);
    }
    
    const keyId = Object.keys(serverSignatures).find(key => key.includes(':'));
    if (!keyId) {
      logger.warn(`No valid signature key format found for ${serverName}`);
      return failure('M_INVALID_SIGNATURE', `Invalid signature key format`);
    }
    
    const signatureValue = serverSignatures[keyId];
    if (!signatureValue) {
      logger.warn(`Signature value missing for key ${keyId}`);
      return failure('M_INVALID_SIGNATURE', `Signature value missing`);
    }
    
    const [algorithmStr, version] = keyId.split(':');
    
    if (algorithmStr !== EncryptionValidAlgorithm.ed25519) {
      logger.warn(`Unsupported signature algorithm: ${algorithmStr}`);
      return failure('M_INVALID_SIGNATURE', `Unsupported signature algorithm: ${algorithmStr}`);
    }
    
    try {
      const localServerName = getServerName();
      
      const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
        getValidPublicKeyFromLocal,
        (origin, key) => getPublicKeyFromRemoteServer(origin, localServerName, key),
        storePublicKey
      );
      
      const publicKeyB64 = await getPublicKeyFromServer(serverName, keyId);
      if (!publicKeyB64) {
        logger.warn(`Public key not found for ${serverName}:${keyId}`);
        return failure('M_INVALID_SIGNATURE', `Public key not found`);
      }
      
      let publicKeyBytes: Uint8Array;
      let signatureBytes: Uint8Array;
      
      try {
        publicKeyBytes = Uint8Array.from(Buffer.from(publicKeyB64, 'base64'));
        signatureBytes = Uint8Array.from(Buffer.from(signatureValue, 'base64'));
      } catch (decodeError) {
        logger.error(`Failed to decode Base64: ${decodeError}`);
        return failure('M_INVALID_SIGNATURE', 'Failed to decode Base64 key or signature');
      }
      
      const canonicalJson = event.canonicalizedEvent.canonicalJson;
      
      const isValid = nacl.sign.detached.verify(
        new TextEncoder().encode(canonicalJson),
        signatureBytes,
        publicKeyBytes
      );
      
      if (!isValid) {
        logger.warn(`Signature verification failed for ${eventId}`);
        return failure('M_INVALID_SIGNATURE', 'Signature verification failed');
      }
      
      logger.info(`Successfully verified signature for event ${eventId}`);
      return success(event);
      
    } catch (error: any) {
      logger.error(`Error during signature verification: ${error.message || String(error)}`);
      return failure('M_INVALID_SIGNATURE', `Error during signature verification: ${error.message || String(error)}`);
    }
  } catch (error: any) {
    logger.error(`Error validating event signatures: ${error.message || String(error)}`);
    return failure('M_INVALID_SIGNATURE', `Error validating signatures: ${error.message || String(error)}`);
  }
});