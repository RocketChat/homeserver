export {
	toUnpaddedBase64,
	computeHashBuffer,
	computeHashString,
	encodeCanonicalJson,
	toBinaryData,
	fromBinaryData,
	fromBase64ToBytes,
	InvalidSignatureError,
} from './utils/data-types';

export { isValidAlgorithm } from './utils/constants';

export * from './contracts/key';

export {
	loadEd25519SignerFromSeed,
	loadEd25519VerifierFromPublicKey,
	signJson,
	verifyJsonSignature,
	generateEd25519RandomSecretKey,
} from './utils/keys';
