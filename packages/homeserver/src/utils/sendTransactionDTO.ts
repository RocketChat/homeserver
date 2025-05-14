import { t } from "elysia";

export const SendTransactionBodyDTO = t.Object({
  pdus: t.Array(t.Any(), { 
    description: "Protocol Data Units (PDUs) for the transaction" 
  }),
  edus: t.Array(t.Any(), { 
    description: "Ephemeral Data Units (EDUs) for the transaction" 
  })
}, {
  description: "Transaction data for federation requests"
});

export const SendTransactionParamsDTO = t.Object({
  txnId: t.String({
    description: "The transaction ID"
  })
}, {
  description: "Transaction data for federation requests"
});

export const SendTransactionResponseDTO = {
  200: t.Object({
    pdus: t.Optional(t.Record(t.String(), t.Object({
      error: t.Optional(t.String()),
    }))),
  }, {
    description: "Successful transaction processing response"
  }),
  
  400: t.Object({
    errcode: t.String({
      description: "Matrix error code",
      examples: ["M_UNKNOWN", "M_INVALID"]
    }),
    error: t.String({
      description: "Human-readable error message"
    })
  }, {
    description: "Error response when request cannot be processed"
  })
};

export const SendTransactionDTO = {
  body: SendTransactionBodyDTO,
  params: SendTransactionParamsDTO,
  response: SendTransactionResponseDTO,
};