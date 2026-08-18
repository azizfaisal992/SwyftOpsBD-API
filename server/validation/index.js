import { validationError } from "../errors/ApiError.js";

export const requireObjectBody = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("The request body must be a JSON object.", {
      body: "Provide a JSON object.",
    });
  }
  return body;
};

export const readRequiredString = (body, field, options = {}) => {
  requireObjectBody(body);
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  const fields = {};
  if (!value) fields[field] = `${field} is required.`;
  if (value && options.maxLength && value.length > options.maxLength) {
    fields[field] = `${field} must be ${options.maxLength} characters or fewer.`;
  }
  if (Object.keys(fields).length > 0) {
    throw validationError("The request contains invalid fields.", fields);
  }
  return value;
};
