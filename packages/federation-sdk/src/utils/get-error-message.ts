export const getErrorMessage = (error: unknown) => {
	let message = 'Unknown error';

	if (error instanceof Error) {
		message = error.message;
	} else if (typeof error === 'string') {
		message = error;
	} else if (typeof error === 'object' && error !== null) {
		message = JSON.stringify(error);
	}

	return message;
};
