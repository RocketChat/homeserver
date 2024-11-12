// https://spec.matrix.org/v1.10/server-server-api/#transactions

interface PDU {
  pdu_type: string;
  content: any;
}

interface EDU {
  edu_type: string;
  content: any;
}

interface Body {
  edus?: EDU[];
  pdus: PDU[];

  room_id: string;
  origin: string;
  origin_server_ts: number;
}

interface Response {
  pdus: Record<
    `${string}:${string}`,
    | {
        error: string;
      }
    | {}
  >;
}

declare module "./endpoints" {
  interface Endpoints {
    "/v1/send/{txnId}": {
      PUT: {
        description: "The transfer of EDUs and PDUs between homeservers is performed by an exchange of Transaction messages, which are encoded as JSON objects, passed over an HTTP PUT request. A Transaction is meaningful only to the pair of homeservers that exchanged it; they are not globally-meaningful.";
        auth: true;
        rateLimit: false;
        query: Body;
        response: Response;
      };
    };
  }
}
