export class MultiError extends Error {
	private _finalMessage = '';

	append(message: string, error: Error) {
		this._finalMessage += message ? `\n${message}: ${error.message}` : error.message;
	}

	concat(other: MultiError) {
		const n = new MultiError();
		n._finalMessage = this._finalMessage + other._finalMessage;
		return n;
	}

	get message() {
		return this._finalMessage;
	}

	static isMultiError(error: unknown): error is MultiError {
		return error instanceof MultiError;
	}
}
