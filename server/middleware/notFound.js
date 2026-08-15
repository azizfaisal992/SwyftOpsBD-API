import { notFound } from "../errors/ApiError.js";

export const notFoundHandler = (request, _response, next) => {
  next(notFound(`No API route matches ${request.method} ${request.originalUrl}.`));
};
