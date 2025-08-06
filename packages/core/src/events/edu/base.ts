/**
 * EDU (Ephemeral Data Unit) as defined in the Matrix specification
 * An EDU is an event that is ephemeral and not persisted in room history
 *
 * According to the Matrix spec, EDUs are ephemeral events that are sent
 * between servers but are not part of the room's persistent state.
 * They include things like typing indicators, presence updates, and read receipts.
 *
 * @see https://spec.matrix.org/latest/server-server-api/#edus
 */
export interface MatrixEDU {
	edu_type: string;
	content: Record<string, unknown>;
	origin?: string;
}

export interface BaseEDU extends MatrixEDU {
	edu_type: string;
	content: Record<string, unknown>;
	origin?: string;
}

export interface FederationEDUResponse {
	edus: MatrixEDU[];
}

export const isMatrixEDU = (obj: unknown): obj is MatrixEDU => {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}

	const edu = obj as Record<string, unknown>;
	return (
		typeof edu.edu_type === 'string' &&
		typeof edu.content === 'object' &&
		edu.content !== null
	);
};

export const isFederationEDUResponse = (
	obj: unknown,
): obj is FederationEDUResponse => {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}

	const response = obj as Record<string, unknown>;
	return 'edus' in response && Array.isArray(response.edus);
};

export const isFederationEventWithEDUs = (
	response: unknown,
): response is FederationEDUResponse => {
	if (typeof response !== 'object' || response === null) {
		return false;
	}

	const obj = response as Record<string, unknown>;
	return 'edus' in obj && Array.isArray(obj.edus) && obj.edus.length > 0;
};
