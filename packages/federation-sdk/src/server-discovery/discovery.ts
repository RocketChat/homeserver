import { Resolver } from "node:dns/promises";
import { isIP, isIPv6 } from "node:net";

// typing below are purely to document and make sure we conform to how we are returning the address

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
  private _finalMessage: string = "";
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

const resolver = getResolver();

async function resolveHostname(
  hostname: string,
  resolveCname: boolean
): Promise<IP4or6String> {
  const errors = new MultiError();

  // in order as in spec
  // CNAME, AAAA, A

  const promises = [];

  if (resolveCname) {
    promises.push(resolver.resolveCname(hostname));
  }

  promises.push(resolver.resolve6(hostname), resolver.resolve4(hostname));

  const all = await Promise.allSettled(promises).then((results) => {
    return results.map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      }

      errors.append("", result.reason);
      return [];
    });
  });

  for (const resolved of all) {
    if (resolved.length > 0) {
      return isIPv6(resolved[0])
        ? (`[${resolved[0]}]` as const)
        : (resolved[0] as IP4or6String); // FIXME: the typing for some reason is not allowing me to do 'as const'
    }
  }

  throw errors;
}

// SPEC: https://spec.matrix.org/v1.12/server-server-api/#resolving-server-names

/*
 * Server names are resolved to an IP address and port to connect to, and have various conditions affecting which certificates and Host headers to send.
 */

export async function getHomeserverFinalAddress(
  addr: AddressSrring
): Promise<[IP4or6WithPortAndProtocolString, HostHeaders]> {
  const { hostname, port } = new _URL(addr);

  /*
   * SPEC:
   * 1. If the hostname is an IP literal, then that IP address should be used, together with the given port number, or 8448 if no port is given. The target server must present a valid certificate for the IP address. The Host header in the request should be set to the server name, including the port if the server name included one.
   */

  if (isIP(hostname)) {
    const finalIp = isIPv6(hostname) ? `[${hostname}]` : hostname; // wrap in []
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
      const [addr, hostHeaders] = await fromSRVResolutionWithBasicFallback(
        hostname
      );

      return [`https://${addr}` as const, hostHeaders];
    } catch (e2: unknown) {
      if (isMultiError(e) && isMultiError(e2)) {
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
  host: string
): Promise<[IP4or6WithPortAndProtocolString, HostHeaders]> {
  //   if (WELLKNOWN_CACHE.has(host)) {
  //     const cached = WELLKNOWN_CACHE.get(host);
  //     if (cached && cached.validUntil > Date.now()) {
  //       return cached.addr;
  //     }
  //   }

  const isWellKnownResponse = (
    response: unknown
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

  // SPEC: Servers should respect the cache control headers present on the response, or use a sensible default when headers are not present. The recommended sensible default is 24 hours. Servers should additionally impose a maximum cache time for responses: 48 hours is recommended.
  const cacheControl = response.headers.get("cache-control");
  let maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  const MAX_CACHE_ALLOWED_IN_SECONDS = 48 * 60 * 60 * 1000; // 48 hours in milli9seconds

  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/);
    if (match) {
      maxAge = Math.min(
        Number.parseInt(match[1], 10),
        MAX_CACHE_ALLOWED_IN_SECONDS
      );
    }
  }

  const validUntil = Date.now() + maxAge;

  WELLKNOWN_CACHE.set(host, { addr: data["m.server"], validUntil });

  const { hostname: delegatedHostname, port: delegatedPort } = new _URL(
    data["m.server"]
  );

  // SPEC: 3.1. If <delegated_hostname> is an IP literal, then that IP address should be used together with the <delegated_port> or 8448 if no port is provided. The target server must present a valid TLS certificate for the IP address.

  if (isIP(delegatedHostname)) {
    // bundler will take care of this pointless reassignment
    const delegatedIp = delegatedHostname;
    const finalAddress = `https://${delegatedIp}:${
      delegatedPort || DEFAULT_PORT
    }` as const;
    return [
      finalAddress,
      {
        /* SPEC: Requests must be made with a Host header containing the IP address, including the port if one was provided. */
        Host: `${delegatedIp}:${delegatedPort ? `:${delegatedPort}` : ""}`,
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
  const [addr, hostHeaders] = await fromSRVResolutionWithBasicFallback(
    delegatedHostname
  );
  return [`https://${addr}` as const, hostHeaders];
}

// SPEC: If the /.well-known request resulted in an error response, a server is found by resolving an SRV record for _matrix-fed._tcp.<hostname>. This may result in a hostname (to be resolved using AAAA or A records) and port. Requests are made to the resolved IP address and port, with a Host header of <hostname>. The target server must present a valid certificate for <hostname>.
async function fromSRVDelegation(
  hostname: string
): Promise<[IP4or6WithPortString, HostHeaders]> {
  const _do = async (
    name: string
  ): Promise<Awaited<ReturnType<typeof fromSRVDelegation>> | undefined> => {
    const srvs = await resolver.resolveSrv(name);

    for (const srv of srvs) {
      try {
        const addr = await resolveHostname(srv.name, false);
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
  hostname: AddressString
): Promise<[IP4or6WithPortString, HostHeaders]> {
  // SPEC: 6. If the /.well-known request returned an error response, and no SRV records were found, an IP address is resolved using CNAME, AAAA and A records. Requests are made to the resolved IP address using port 8448 and a Host header containing the <hostname>. The target server must present a valid certificate for <hostname>.
  try {
    return await fromSRVDelegation(hostname);
  } catch (e: unknown) {
    try {
      const resolved = await resolveHostname(hostname, true);

      return [`${resolved}:${DEFAULT_PORT}` as const, { Host: hostname }];
    } catch (e2: unknown) {
      if (isMultiError(e) && isMultiError(e2)) {
        throw e.concat(e2);
      }

      console.log(e, e2);

      throw new Error(`failed to resolve ${hostname}`);
    }
  }
}
