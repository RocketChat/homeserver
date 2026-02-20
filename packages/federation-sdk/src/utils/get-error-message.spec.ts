import { describe, expect, it } from 'bun:test';

import { getErrorMessage } from './get-error-message';

describe('getErrorMessage', () => {
	it('should return the message from an Error object', () => {
		const error = new Error('Test error message');

		expect(getErrorMessage(error)).toBe('Test error message');
	});

	it('should handle custom Error classes', () => {
		class CustomError extends Error {
			constructor(message: string) {
				super(message);
				this.name = 'CustomError';
			}
		}

		const error = new CustomError('Custom error message');

		expect(getErrorMessage(error)).toBe('Custom error message');
	});

	it('should use the string directly if error is a string', () => {
		const errorString = 'Error as a string';

		expect(getErrorMessage(errorString)).toBe('Error as a string');
	});

	it('should stringify objects', () => {
		const errorObject = { code: 500, message: 'Internal Server Error' };

		expect(getErrorMessage(errorObject)).toBe(JSON.stringify(errorObject));
	});

	it('should return "Unknown error" for null', () => {
		expect(getErrorMessage(null)).toBe('Unknown error');
	});

	it('should return "Unknown error" for undefined', () => {
		expect(getErrorMessage(undefined)).toBe('Unknown error');
	});

	it('should return "Unknown error" for non-error values', () => {
		expect(getErrorMessage(123)).toBe('Unknown error');
		expect(getErrorMessage(true)).toBe('Unknown error');
	});
});
