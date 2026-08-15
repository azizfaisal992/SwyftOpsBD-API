import { adminAuth } from "../firebaseAdmin.js";
import { ADMIN_ROLES as ADMIN_ROLE_LIST } from "../config/roles.js";
import { ApiError, forbidden, unauthorized } from "../errors/ApiError.js";

export const ADMIN_ROLES = new Set(ADMIN_ROLE_LIST);

export const authenticate = async (request, response, next) => {
  const authorization = request.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(unauthorized("A Firebase Bearer token is required."));
  }

  try {
    request.user = await adminAuth.verifyIdToken(token, true);
    return next();
  } catch (error) {
    console.error("Firebase token verification failed.", {
      requestId: request.id,
      code: error?.code || "unknown",
      message: error?.message || "Unknown Firebase verification error.",
    });
    if (error?.code === "auth/id-token-expired") {
      return next(unauthorized("Your Firebase session expired. Sign in again."));
    }
    if (error?.code === "auth/id-token-revoked") {
      return next(unauthorized("Your Firebase session was revoked. Sign in again."));
    }
    if (error?.code === "auth/user-disabled") {
      return next(unauthorized("This account has been suspended."));
    }
    if ([
      "auth/argument-error",
      "auth/invalid-id-token",
      "auth/invalid-argument",
    ].includes(error?.code)) {
      return next(unauthorized("The Firebase authentication token is invalid."));
    }
    return next(new ApiError(
      503,
      "AUTH_SERVICE_UNAVAILABLE",
      "The backend Firebase authentication service is unavailable.",
    ));
  }
};

export const requireRole = (...allowedRoles) => {
  const allowed = new Set(allowedRoles);
  return (request, response, next) => {
    void response;
    if (!allowed.has(request.user?.role)) {
      return next(forbidden("Your account role cannot perform this action."));
    }
    return next();
  };
};

export const requireAdmin = (request, response, next) => {
  if (
    request.user?.admin !== true ||
    !ADMIN_ROLES.has(request.user?.role)
  ) {
    return next(forbidden("Administrator access is required."));
  }
  return next();
};

export const requireAdminRole = (...allowedRoles) => {
  const allowed = new Set(allowedRoles);
  return (request, response, next) => {
    if (
      request.user?.admin !== true ||
      !ADMIN_ROLES.has(request.user?.role) ||
      !allowed.has(request.user.role)
    ) {
      return next(forbidden("Your administrator role cannot perform this action."));
    }
    return next();
  };
};
