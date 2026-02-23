/*
 * Use https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/ for reference.
 * https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/#tag
 */

// " Technically there is a maximum integer in DER but it’s extraordinarily large: The length of any DER field can be expressed as a series of up to 126 bytes."
function encodeLength(len: number): Uint8Array {
	if (len < 128) {
		// short form
		return Uint8Array.of(len); // save length in a single byte
	}

	// long form
	const bytes = [];

	let value = len;
	while (value > 0) {
		bytes.unshift(value & /* only pick the on bits */ 0xff /* all ones */);
		value >>= 8; // move the "window" to right - multi byte integer
	}

	return Uint8Array.of(
		0x80 /* "The long form is at least two bytes long, and has bit 8 of the first byte set to 1." */ |
			/* turn on the bits that will represent the next bytes that represent the length */ bytes.length,
		...bytes,
	);
}

// https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/#other-notation
export const privateKeyVersionTlv = Uint8Array.of(
	0x02 /* tag for int */,
	0x01 /* legth */,
	0x00 /* version of private key, we are not using extensions*/,
);

//
export const ed25519oid = '1.3.101.112';

// https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/#object-identifier-encoding
// copilot: break _ed25519oid into bytes with hex codes, save to bytes array
// ^ thanks copilot
// const bytes = Uint8Array.of( 0x2b /* 1*40 + 3 = 43 = 0x2b */, 0x65, 0x70 /* 101, 112 */ );
export const oidTlv = Uint8Array.of(
	0x06 /* tag for oid */,
	...encodeLength(3), // check comment above
	0x2b /* 1*40 + 3 = 43 = 0x2b */,
	0x65, // 101
	0x70, // 112
);

// https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/#null-encoding
export const nullTlv = Uint8Array.of(0x05 /* tag for null */, 0x00 /* length 0 */);

// https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/#sequence-encoding
export function sequenceOrderedTlv(elements: Uint8Array[]): Uint8Array {
	const totalLengthInBytes = elements.reduce((a, b) => a + b.length, 0);

	const bytesRepresentationForTotalLengthRequired = encodeLength(totalLengthInBytes);

	const numberOfBytesRequired =
		1 + bytesRepresentationForTotalLengthRequired.length /* bytes needed for the length itself*/ + totalLengthInBytes;

	const sequence = new Uint8Array(numberOfBytesRequired);

	// TAG
	sequence[0] = 0x30; // SEQUENCE tag

	// LENGTH
	sequence.set(bytesRepresentationForTotalLengthRequired, 1);

	// VALUE
	let offset = 1 + bytesRepresentationForTotalLengthRequired.length;
	for (const el of elements) {
		// set each element according while moving the window
		sequence.set(el, offset);
		offset += el.length;
	}

	return sequence;
}

// https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/#octet-string-encoding
export function octetStringTlv(data: Uint8Array): Uint8Array {
	const encodedLength = encodeLength(data.length);

	const octet = new Uint8Array(1 + encodedLength.length /* space just for the length representation */ + data.length);

	// TAG
	octet[0] = 0x04; // OCTET STRING tag
	// LENGTH
	octet.set(encodedLength, 1);
	// VALUE
	octet.set(data, 1 + encodedLength.length);

	return octet;
}

export const algorithmIdentifierTlv = sequenceOrderedTlv([
	oidTlv,
	// nullTlv, // parameters for ed25519 is NULL
]);

// https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/#bit-string-encoding
export function bitStringTlv(data: Uint8Array) {
	//  with a one-byte prefix that contains the “number of unused bits,” for clarity when the number of bits is not a multiple of 8
	const unusedBits = 0; // "In DER, the unused bits must all be zero."

	const lengthBytes = encodeLength(data.length + 1); // +1 for unused bits byte

	return new Uint8Array([
		0x03, // TAG
		...lengthBytes, // LENGTH
		unusedBits, // VALUE - unused bits
		...data, // VALUE - actual data
	]);
}
