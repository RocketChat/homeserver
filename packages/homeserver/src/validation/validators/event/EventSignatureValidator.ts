import nacl from 'tweetnacl';
import { getPublicKeyFromRemoteServer, makeGetPublicKeyFromServerProcedure } from '../../../procedures/getPublicKeyFromServer';
import { EncryptionValidAlgorithm } from '../../../signJson';
import { extractOrigin } from '../../../utils/extractOrigin';
import { getValidPublicKeyFromLocal, storePublicKey } from '../../../utils/keyStore';
import { getServerName } from '../../../utils/serverConfig';
import { failure, success } from '../../ValidationResult';
import { createValidator } from '../../Validator';
import type { CanonicalizedEvent } from '../EventValidators';

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
      console.warn(`Event ${eventId} missing canonicalJson from CanonicalizeEvent validator`);
      return failure('M_MISSING_CANONICAL_JSON', 'Event missing canonicalJson');
    }
    
    if (!event.event.signatures) {
      console.warn(`Event ${eventId} missing signatures`);
      return failure('M_MISSING_SIGNATURES', 'Event is missing required signatures');
    }
    
    const serverName = extractOrigin(event.event.sender);
    const serverSignatures = event.event.signatures[serverName];
    if (!serverSignatures || Object.keys(serverSignatures).length === 0) {
      console.warn(`Missing/empty signatures from origin server ${serverName}`);
      return failure('M_INVALID_SIGNATURE', `Event is missing signature from origin server ${serverName}`);
    }
    
    const keyId = Object.keys(serverSignatures).find(key => key.includes(':'));
    if (!keyId) {
      console.warn(`No valid signature key format found for ${serverName}`);
      return failure('M_INVALID_SIGNATURE', 'Invalid signature key format');
    }
    
    const signatureValue = serverSignatures[keyId];
    if (!signatureValue) {
      console.warn(`Signature value missing for key ${keyId}`);
      return failure('M_INVALID_SIGNATURE', 'Signature value missing');
    }
    
    const [algorithmStr, version] = keyId.split(':');
    
    if (algorithmStr !== EncryptionValidAlgorithm.ed25519) {
      console.warn(`Unsupported signature algorithm: ${algorithmStr}`);
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
        console.warn(`Public key not found for ${serverName}:${keyId}`);
        return failure('M_INVALID_SIGNATURE', 'Public key not found');
      }
      
      let publicKeyBytes: Uint8Array;
      let signatureBytes: Uint8Array;
      
      try {
        publicKeyBytes = Uint8Array.from(Buffer.from(publicKeyB64, 'base64'));
        signatureBytes = Uint8Array.from(Buffer.from(signatureValue, 'base64'));
      } catch (decodeError) {
        console.error(`Failed to decode Base64: ${decodeError}`);
        return failure('M_INVALID_SIGNATURE', 'Failed to decode Base64 key or signature');
      }
      
      const canonicalJson = event.canonicalizedEvent.canonicalJson;
      
      const isValid = nacl.sign.detached.verify(
        new TextEncoder().encode(canonicalJson),
        signatureBytes,
        publicKeyBytes
      );
      
      if (!isValid) {
        console.warn(`Signature verification failed for ${eventId}`);
        return failure('M_INVALID_SIGNATURE', 'Signature verification failed');
      }
      
      console.info(`Successfully verified signature for event ${eventId}`);
      return success(event);
      
    } catch (error: unknown) {
      console.error(`Error during signature verification: ${String(error)}`);
      return failure('M_INVALID_SIGNATURE', `Error during signature verification: ${String(error)}`);
    }
  } catch (error: unknown) {
    console.error(`Error validating event signatures: ${String(error)}`);
    return failure('M_INVALID_SIGNATURE', `Error validating signatures: ${String(error)}`);
  }
});