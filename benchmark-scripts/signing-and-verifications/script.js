import http from "k6/http";

function _payload() {
  const messagelength = __ENV.MESSAGE_LENGTH || "1024";
  const engine = __ENV.ENGINE || "tweetnacl";

  const stream = !!__ENV.STREAM;

  return JSON.stringify({
    message: messagelength,
    api: {
      engine,
      stream,
    },
  });
}

const payload = _payload();

console.log("payload:", payload);

export default function () {
  http.post(`http://localhost:${__ENV.PORT || 8080}/signAndVerify`, payload, {
    headers: {
      "content-type": "application/json",
    },
  });
}
