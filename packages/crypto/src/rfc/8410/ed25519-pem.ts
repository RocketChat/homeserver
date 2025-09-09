import {
	algorithmIdentifierTlv,
	bitStringTlv,
	octetStringTlv,
	privateKeyVersionTlv,
	sequenceOrderedTlv,
} from '../../der';

enum KeyType {
	private = 'PRIVATE KEY',
	public = 'PUBLIC KEY',
}

export function toPem(base64: string, type: KeyType): string {
	const lines = [`-----BEGIN ${type}-----`];
	for (let i = 0; i < base64.length; i += 64) {
		lines.push(base64.substring(i, 64));
	}
	lines.push(`-----END ${type}-----`);
	return lines.join('\n');
}

/*
 *    OneAsymmetricKey ::= SEQUENCE {
      version Version,
      privateKeyAlgorithm PrivateKeyAlgorithmIdentifier,
      privateKey PrivateKey,
      attributes [0] IMPLICIT Attributes OPTIONAL,
      ...,
      [[2: publicKey [1] IMPLICIT PublicKey OPTIONAL ]],
      ...
   }

   CTET
   PrivateKey ::= OCTET { OCTET STRING }
 * We don't use extensions
*/
export function ed25519PrivateKeyRawToPem(rawKey: Uint8Array): string {
	if (rawKey.length !== 32) {
		throw new Error('Invalid Ed25519 private key length');
	}
	// version Version
	const version = privateKeyVersionTlv;
	// privateKeyAlgorithm PrivateKeyAlgorithmIdentifier
	const algId = algorithmIdentifierTlv;
	// privateKey PrivateKey -> OCTET STRING

	const privKeyOctet = octetStringTlv(
		octetStringTlv(rawKey),
	); /* The ASN.1 type CurvePrivateKey is defined in
   this document to hold the byte sequence.  Thus, when encoding a
   OneAsymmetricKey object, the private key is wrapped in a
   CurvePrivateKey object and wrapped by the OCTET STRING of the
   "privateKey" field.
   */
	// OneAsymmetricKey -> SEQUENCE
	const oneAsymmetricKey = sequenceOrderedTlv([version, algId, privKeyOctet]);
	// :)
	return toPem(
		Buffer.from(oneAsymmetricKey).toString('base64'),
		KeyType.private,
	);
}

/*
 * SubjectPublicKeyInfo ::= SEQUENCE {
	  algorithm AlgorithmIdentifier,
	  subjectPublicKey BIT STRING
	}

	AlgorithmIdentifier ::= SEQUENCE {
	  algorithm OBJECT IDENTIFIER (1.3.101.112 for Ed25519),
	  parameters NULL
	}
*/
export function ed25519PublicKeyRawToPem(rawKey: Uint8Array): string {
	if (rawKey.length !== 32) {
		throw new Error('Invalid Ed25519 public key length');
	}
	// algorithm AlgorithmIdentifier
	const algId = algorithmIdentifierTlv;
	// subhjectPublicKey BIT STRING
	const pubKeyBitString = bitStringTlv(rawKey);
	// SubjectPublicKeyInfo -> SEQUENCE
	const spki = sequenceOrderedTlv([algId, pubKeyBitString]);

	return toPem(Buffer.from(spki).toString('base64'), KeyType.public);
}
