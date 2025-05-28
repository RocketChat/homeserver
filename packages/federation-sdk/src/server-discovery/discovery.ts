import { resolver } from "./_resolver";
import { isIPv4, isIPv6 } from "node:net";
import { _URL } from "./_url";
import { MultiError } from "./_multi-error";

// typing below are purely to document and make sure we conform to how we are returning the address
// ge4tting typescript to help me not return wrong stuff

type PortString = string;

type IP4or6String = string | `[${string}]`;
type AddressString = string;

type AddressWithPortString = `${AddressString}:${PortString | number}`;
type IP4or6WithPortString = `${IP4or6String}:${PortString | number}`;

type AddressWithPortAndProtocolString = `${
	| "http"
	| "https"}://${AddressWithPortString}`;

type IP4or6WithPortAndProtocolString = `${
	| "http"
	| "https"}://${IP4or6WithPortString}`;

type HostHeaders = {
	Host: AddressString | AddressWithPortString | IP4or6WithPortString;
};

const DEFAULT_PORT = "8448";

const WELLKNOWN_CACHE = new Map<string, { addr: string; validUntil: number }>();

class MultiError extends Error {
  private _finalMessage = "";
  append(message: string, error: Error) {
    this._finalMessage += message
      ? `\n${message}: ${error.message}`
      : error.message;
  }

  concat(other: MultiError) {
    const n = new MultiError();
    n._finalMessage = this._finalMessage + other._finalMessage;
    return n;
  }

  get message() {
    return this._finalMessage;
  }
}

// use this to parse since .split would incorrectly parse any ipv6 addresses
class _URL extends URL {
  constructor(url: string) {
    if (/https?:\/\//.test(url)) {
      super(url);
    } else {
      super(`https://${url}`);
    }
  }

  isIP() {
    return isIPv4(this.hostname) || isIPv6(this.ipv6);
  }

  // isIPv6 fails if ip is wrapped in []
  get ipv6() {
    return this.hostname.replace(/^\[|\]$/g, "");
  }
}

function isMultiError(error: unknown): error is MultiError {
  return error instanceof MultiError;
}

function getResolver() {
  const resolver = new Resolver();

  if (process.env.HOMESERVER_CONFIG_DNS_SERVERS) {
    const servers = process.env.HOMESERVER_CONFIG_DNS_SERVERS.split(",").map(
      (s) => s.trim()
    );

    resolver.setServers(servers);
  }

  return resolver;
}

// should only be needed if input is from a dns server
function fix6(addr: string): `[${string}]` {
	return /^\[.+\]$/.test(addr) ? (addr as `[${string}]`) : `[${addr}]`;
}

export async function resolveHostname(
	hostname: string,
	resolveCname: boolean,
): Promise<IP4or6String> {
	const errors = new MultiError();

	// in order as in spec
	// CNAME, AAAA, A
	const promises = [];

	if (resolveCname) {
		promises.push(resolver.resolveCname(hostname));
	}

	promises.push(resolver.resolve4And6(hostname));

	const results = await Promise.allSettled(promises);

	for (const result of results) {
		if (result.status === "rejected") {
			errors.append("", result.reason);
			continue;
		}

		const ips = result.value; // array of ips

		if (ips.length > 0) {
			return isIPv6(ips[0]) ? fix6(ips[0]) : ips[0];
		}
	}

	throw errors;
}

// SPEC: https://spec.matrix.org/v1.12/server-server-api/#resolving-server-names

/*
 * Server names are resolved to an IP address and port to connect to, and have various conditions affecting which certificates and Host headers to send.
 */

export async function getHomeserverFinalAddress(
	addr: AddressString,
): Promise<[IP4or6WithPortAndProtocolString, HostHeaders]> {
	const url = new _URL(addr);

	const { hostname, port } = url;

	/*
	 * SPEC:
	 * 1. If the hostname is an IP literal, then that IP address should be used, together with the given port number, or 8448 if no port is given. The target server must present a valid certificate for the IP address. The Host header in the request should be set to the server name, including the port if the server name included one.
	 */

	if (url.isIP()) {
		const finalIp = hostname; // should already be wrapped in [] if it is ipv6
		const finalPort = port || DEFAULT_PORT;
		// "Target server must present a valid certificate for the IP address", i.e. always https
		const finalAddress = `https://${finalIp}:${finalPort}` as const;
		const hostHeader = {
			Host: `${hostname}${
				/* only include port if it was included already */
				port ? `:${port}` : ""
			}`,
		};

		return [finalAddress, hostHeader];
	}

	/*
	 * SPEC:
	 * 2. If the hostname is not an IP literal, and the server name includes an explicit port, resolve the hostname to an IP address using CNAME, AAAA or A records. Requests are made to the resolved IP address and given port with a Host header of the original server name (with port). The target server must present a valid certificate for the hostname.
	 */

	// includes explicit port
	if (port) {
		const hostHeaders = { Host: `${hostname}:${port}` as const }; // original serverName and port

		const address = await resolveHostname(hostname, true); // intentional auto-throw

		return [`https://${address}:${port}` as const, hostHeaders];
	}

	/*
	 * SPEC:
	 * 3. wellknown delegation
	 */

	try {
		const [addr, hostHeaders] = await fromWellKnownDelegation(hostname);

		// found one -
		return [addr, hostHeaders];
	} catch (e: unknown) {
		// didn't find a suitable result from wellknnown

		try {
			const [addr, hostHeaders] =
				await fromSRVResolutionWithBasicFallback(hostname);

			return [`https://${addr}` as const, hostHeaders];
		} catch (e2: unknown) {
			if (MultiError.isMultiError(e) && MultiError.isMultiError(e2)) {
				throw e.concat(e2);
			}

			console.log(e, e2);

			throw new Error(`failed to resolve ${hostname}`);
		}
	}
}

type WellKnownResponse = {
	"m.server": string;
};

// error must be caught and handled by the caller
async function fromWellKnownDelegation(
	host: string,
): Promise<[IP4or6WithPortAndProtocolString, HostHeaders]> {
	const isWellKnownResponse = (
		response: unknown,
	): response is WellKnownResponse => {
		return (
			typeof response === "object" &&
			response !== null &&
			"m.server" in response &&
			typeof response["m.server"] === "string"
		);
	};

	// SPEC: 3. If the hostname is not an IP literal, a regular HTTPS request is made to https://<hostname>/.well-known/matrix/server,

	const response = await fetch(`https://${host}/.well-known/matrix/server`, {
		headers: {
			Accept: "application/json",
		},
		// SPEC: 30x redirects should be followed
		redirect: "follow",
	});

	// SPEC: Errors are recommended to be cached for up to an hour, and servers are encouraged to exponentially back off for repeated failures.
	// TODO: ^^^

	// SPEC: If the response is invalid (bad JSON, missing properties, non-200 response, etc), skip to step 4.
	//
	if (!response.ok) {
		const [addr, hostHeaders] = await fromSRVResolutionWithBasicFallback(host);
		return [`https://${addr}` as const, hostHeaders];
	}

	const data = await response.json();

	if (!isWellKnownResponse(data)) {
		const [addr, hostHeaders] = await fromSRVResolutionWithBasicFallback(host);
		return [`https://${addr}` as const, hostHeaders];
	}

	if (!data["m.server"]) {
		// TODO: should this be like this?
		const [addr, hostHeaders] = await fromSRVResolutionWithBasicFallback(host);
		return [`https://${addr}` as const, hostHeaders];
	}

	const url = new _URL(data["m.server"]);

	const { hostname: delegatedHostname, port: delegatedPort } = url;

	// SPEC: 3.1. If <delegated_hostname> is an IP literal, then that IP address should be used together with the <delegated_port> or 8448 if no port is provided. The target server must present a valid TLS certificate for the IP address.

	if (url.isIP()) {
		// compiler should take care of this redundant reassignment
		const delegatedIp = delegatedHostname;
		const finalAddress = `https://${delegatedIp}:${
			delegatedPort || DEFAULT_PORT
		}` as const;
		return [
			finalAddress,
			{
				/* SPEC: Requests must be made with a Host header containing the IP address, including the port if one was provided. */
				Host: `${delegatedIp}${delegatedPort ? `:${delegatedPort}` : ""}`,
			},
		];
	}

	// SPEC: 3.2. If <delegated_hostname> is not an IP literal, and <delegated_port> is present, an IP address is discovered by looking up CNAME, AAAA or A records for <delegated_hostname>. The resulting IP address is used, alongside the <delegated_port>.

	if (delegatedPort) {
		const addr = await resolveHostname(delegatedHostname, true);

		return [
			`https://${addr}:${delegatedPort}`,
			// SPEC: Requests must be made with a Host header of <delegated_hostname>:<delegated_port>. The target server must present a valid certificate for <delegated_hostname>.
			{ Host: `${delegatedHostname}:${delegatedPort}` },
		];
	}

	// SPEC: 3.3. If <delegated_hostname> is not an IP literal and no <delegated_port> is present, an SRV record is looked up for _matrix-fed._tcp.<delegated_hostname>. This may result in another hostname (to be resolved using AAAA or A records) and port. Requests should be made to the resolved IP address and port with a Host header containing the <delegated_hostname>. The target server must present a valid certificate for <delegated_hostname>.
	const [addr, hostHeaders] =
		await fromSRVResolutionWithBasicFallback(delegatedHostname);
	return [`https://${addr}` as const, hostHeaders];
}

// SPEC: If the /.well-known request resulted in an error response, a server is found by resolving an SRV record for _matrix-fed._tcp.<hostname>. This may result in a hostname (to be resolved using AAAA or A records) and port. Requests are made to the resolved IP address and port, with a Host header of <hostname>. The target server must present a valid certificate for <hostname>.
async function fromSRVDelegation(
	hostname: string,
): Promise<[IP4or6WithPortString, HostHeaders]> {
	const _do = async (
		name: string,
	): Promise<Awaited<ReturnType<typeof fromSRVDelegation>> | undefined> => {
		const srvs = await resolver.resolveSrv(name);

		for (const srv of srvs) {
			const _is4 = isIPv4(srv.name);
			const _is6 = isIPv6(srv.name);

			if (_is4 || _is6) {
				// use as is
				const finalAddress = `${_is6 ? fix6(srv.name) : srv.name}:${
					srv.port
				}` as const;

				return [finalAddress, { Host: hostname }];
			}

			try {
				const _addr = await resolveHostname(srv.name, false);
				const addr = isIPv6(_addr) ? fix6(_addr) : _addr;
				return [`${addr}:${srv.port}` as const, { Host: hostname }];
			} catch (_e) {
				// noop
			}
		}
	};

	const result = await _do(`_matrix-fed._tcp.${hostname}`);
	if (result) {
		return result;
	}

	// SPEC: If <delegated_hostname> is not an IP literal, no <delegated_port> is present, and a _matrix-fed._tcp.<delegated_hostname> SRV record was not found, an SRV record is looked up for _matrix._tcp.<delegated_hostname>. This may result in another hostname (to be resolved using AAAA or A records) and port. Requests should be made to the resolved IP address and port with a Host header containing the <delegated_hostname>. The target server must present a valid certificate for <delegated_hostname>.
	// ^^^ IS DEPRECATED, but implementing anyway for now

	const result2 = await _do(`_matrix._tcp.${hostname}`);
	if (result2) {
		return result2;
	}

	throw new Error(`no srv address found for ${hostname}`);
}

async function fromSRVResolutionWithBasicFallback(
	hostname: AddressString,
): Promise<[IP4or6WithPortString, HostHeaders]> {
	// SPEC: 6. If the /.well-known request returned an error response, and no SRV records were found, an IP address is resolved using CNAME, AAAA and A records. Requests are made to the resolved IP address using port 8448 and a Host header containing the <hostname>. The target server must present a valid certificate for <hostname>.
	try {
		return await fromSRVDelegation(hostname);
	} catch (e: unknown) {
		try {
			const resolved = await resolveHostname(hostname, true);

			return [`${resolved}:${DEFAULT_PORT}` as const, { Host: hostname }];
		} catch (e2: unknown) {
			if (MultiError.isMultiError(e) && MultiError.isMultiError(e2)) {
				throw e.concat(e2);
			}

			console.log(e, e2);

			throw new Error(`failed to resolve ${hostname}`);
		}
	}
}
