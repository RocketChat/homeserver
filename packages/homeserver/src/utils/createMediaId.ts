import Crypto from "node:crypto";

export function createMediaId(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		const randomIndex = Crypto.randomInt(0, characters.length);
		result += characters[randomIndex];
	}
	return result;
}

