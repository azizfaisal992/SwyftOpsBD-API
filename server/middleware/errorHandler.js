import multer from "multer";
import { ApiError } from "../errors/ApiError.js";

const normalizeError = (error) => {
  if (error instanceof ApiError) return error;

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Files must be 5MB or smaller."
      : error.message;
    return new ApiError(400, "UPLOAD_ERROR", message);
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return new ApiError(400, "INVALID_JSON", "The request body contains invalid JSON.");
  }

  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return new ApiError(
      error.status,
      error.code || "REQUEST_ERROR",
      error.message || "The request could not be completed.",
    );
  }

  return new ApiError(
    500,
    "INTERNAL_ERROR",
    "The server could not complete this request.",
  );
};

export const errorHandler = (error, request, response, _next) => {
  void _next;
  const normalized = normalizeError(error);

  if (normalized.status >= 500) {
    console.error(`[${request.id || "no-request-id"}]`, error);
  }

  const payload = {
    error: {
      code: normalized.code,
      message: normalized.message,
      requestId: request.id,
    },
  };
  if (normalized.fields) payload.error.fields = normalized.fields;
  if (normalized.details) payload.error.details = normalized.details;

  return response.status(normalized.status).json(payload);
};
