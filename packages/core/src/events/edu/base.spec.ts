import { describe, expect, test } from 'bun:test';

import { type BaseEDU, type FederationEDUResponse, type MatrixEDU, isFederationEDUResponse, isMatrixEDU } from './base';

describe('BaseEDU', () => {
	describe('isMatrixEDU', () => {
		test('returns true for valid Matrix EDU', () => {
			const matrixEDU: MatrixEDU = {
				edu_type: 'm.typing',
				content: {
					room_id: '!room:example.com',
					user_ids: ['@user:example.com'],
				},
			};

			expect(isMatrixEDU(matrixEDU)).toBe(true);
		});

		test('returns true for Matrix EDU with origin', () => {
			const matrixEDU: MatrixEDU = {
				edu_type: 'm.presence',
				content: {
					push: [{ user_id: '@user:example.com', presence: 'online' }],
				},
				origin: 'example.com',
			};

			expect(isMatrixEDU(matrixEDU)).toBe(true);
		});

		test('returns false for object without edu_type', () => {
			const invalidEDU = {
				content: { test: 'data' },
			};

			expect(isMatrixEDU(invalidEDU)).toBe(false);
		});

		test('returns false for object without content', () => {
			const invalidEDU = {
				edu_type: 'm.typing',
			};

			expect(isMatrixEDU(invalidEDU)).toBe(false);
		});

		test('returns false for null or undefined', () => {
			expect(isMatrixEDU(null)).toBe(false);
			expect(isMatrixEDU(undefined)).toBe(false);
		});

		test('returns false for non-object values', () => {
			expect(isMatrixEDU('string')).toBe(false);
			expect(isMatrixEDU(123)).toBe(false);
			expect(isMatrixEDU(true)).toBe(false);
		});

		test('type guard correctly narrows type', () => {
			const data: unknown = {
				edu_type: 'm.typing',
				content: { room_id: '!room:example.com', user_ids: [] },
			};

			if (isMatrixEDU(data)) {
				// TypeScript should now know this is a MatrixEDU
				expect(data.edu_type).toBe('m.typing');
				expect(data.content).toBeDefined();
			} else {
				throw new Error('Type guard should have returned true');
			}
		});
	});

	describe('isFederationEDUResponse', () => {
		test('returns true for valid federation EDU response', () => {
			const response: FederationEDUResponse = {
				edus: [
					{
						edu_type: 'm.typing',
						content: { room_id: '!room:example.com', user_ids: [] },
					},
				],
			};

			expect(isFederationEDUResponse(response)).toBe(true);
		});

		test('returns true for federation response with empty EDUs array', () => {
			const response: FederationEDUResponse = {
				edus: [],
			};

			expect(isFederationEDUResponse(response)).toBe(true);
		});

		test('returns true for federation response with multiple EDUs', () => {
			const response: FederationEDUResponse = {
				edus: [
					{
						edu_type: 'm.typing',
						content: { room_id: '!room1:example.com', user_ids: [] },
					},
					{
						edu_type: 'm.presence',
						content: { push: [] },
					},
				],
			};

			expect(isFederationEDUResponse(response)).toBe(true);
		});

		test('returns false for object without edus property', () => {
			const invalidResponse = {
				other_field: 'value',
			};

			expect(isFederationEDUResponse(invalidResponse)).toBe(false);
		});

		test('returns false for object with non-array edus', () => {
			const invalidResponse = {
				edus: 'not an array',
			};

			expect(isFederationEDUResponse(invalidResponse)).toBe(false);
		});

		test('returns false for null or undefined', () => {
			expect(isFederationEDUResponse(null)).toBe(false);
			expect(isFederationEDUResponse(undefined)).toBe(false);
		});

		test('returns false for non-object values', () => {
			expect(isFederationEDUResponse('string')).toBe(false);
			expect(isFederationEDUResponse(123)).toBe(false);
			expect(isFederationEDUResponse(true)).toBe(false);
		});

		test('type guard correctly narrows type', () => {
			const data: unknown = {
				edus: [
					{
						edu_type: 'm.typing',
						content: { room_id: '!room:example.com', user_ids: [] },
					},
				],
			};

			if (isFederationEDUResponse(data)) {
				// TypeScript should now know this is a FederationEDUResponse
				expect(Array.isArray(data.edus)).toBe(true);
				expect(data.edus).toHaveLength(1);
			} else {
				throw new Error('Type guard should have returned true');
			}
		});
	});

	describe('BaseEDU interface', () => {
		test('BaseEDU has correct structure', () => {
			const baseEDU: BaseEDU = {
				edu_type: 'm.custom',
				content: { custom_field: 'value' },
			};

			expect(baseEDU).toHaveProperty('edu_type');
			expect(baseEDU).toHaveProperty('content');
			expect(typeof baseEDU.edu_type).toBe('string');
			expect(typeof baseEDU.content).toBe('object');
		});

		test('BaseEDU with origin', () => {
			const baseEDU: BaseEDU = {
				edu_type: 'm.custom',
				content: { custom_field: 'value' },
				origin: 'example.com',
			};

			expect(baseEDU).toHaveProperty('origin');
			expect(typeof baseEDU.origin).toBe('string');
		});
	});
});
