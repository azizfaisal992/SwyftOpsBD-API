import { randomUUID } from "node:crypto";

const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

export const requestId = (request, response, next) => {
  const supplied = request.get("x-request-id");
  request.id = supplied && SAFE_REQUEST_ID.test(supplied)
    ? supplied
    : `req_${randomUUID()}`;
  response.set("x-request-id", request.id);
  next();
};
