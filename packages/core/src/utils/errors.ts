export class MatrixError<TCode extends string> extends Error {
	constructor(public readonly code: TCode, message: string) {
		super(message);
		this.name = 'MatrixError';
	}
}
