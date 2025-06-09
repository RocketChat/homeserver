import { isIPv4, isIPv6 } from 'node:net';

// use this to parse since .split would incorrectly parse any ipv6 addresses
export class _URL extends URL {
	private __url: string;

	constructor(url: string) {
		let __url = url;
		if (!/https?:\/\//.test(url)) {
			__url = `https://${url}`;
		}

		super(__url);

		this.__url = __url;
	}

	isIP() {
		return isIPv4(this.hostname) || isIPv6(this.ipv6);
	}

	// isIPv6 fails if ip is wrapped in []
	get ipv6() {
		return this.hostname.replace(/^\[|\]$/g, '');
	}

	get port(): string {
		// if non standard port was specified return as is, default behaviour
		if (super.port) {
			return super.port;
		}

		if (this.__url === this.origin) {
			// nodejs implementation will remove default ports for http and https from origin, maybe more but we don't care about those
			// if the input (__url) and origin matches then no port was specified
			return '';
		}

		// input url and origin (with port removed) did not match, port was removed because of it being defaiult
		return this.protocol === 'https:' ? '443' : '80';
	}
}
