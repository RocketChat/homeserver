// https://spec.matrix.org/v1.9/server-server-api/#getwell-knownmatrixserver

interface Response {
  server: {
    name: string;
    version: string;
  };
}

interface Query {}

declare module "./endpoints" {
  interface Endpoints {
    "/.well-known/matrix/server": {
      GET: {
        auth: false;
        rateLimit: false;
        query: Query;
        response: Response;
      };
    };
  }
}
