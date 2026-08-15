export class ApiError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.details = options.details;
  }
}

export const badRequest = (message, options) =>
  new ApiError(400, "BAD_REQUEST", message, options);

export const unauthorized = (message = "Authentication is required.") =>
  new ApiError(401, "UNAUTHENTICATED", message);

export const forbidden = (message = "You are not allowed to perform this action.") =>
  new ApiError(403, "FORBIDDEN", message);

export const notFound = (message = "The requested resource was not found.") =>
  new ApiError(404, "NOT_FOUND", message);

export const conflict = (message, details) =>
  new ApiError(409, "CONFLICT", message, { details });

export const validationError = (message, fields) =>
  new ApiError(422, "VALIDATION_ERROR", message, { fields });
