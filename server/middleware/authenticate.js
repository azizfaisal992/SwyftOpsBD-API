import { adminAuth } from "../firebaseAdmin.js";

export const ADMIN_ROLES = new Set([
  "super_admin",
  "admin",
  "operations_manager",
  "verification_officer",
  "finance_officer",
  "support_agent",
  "analyst",
]);

export const authenticate = async (request, response, next) => {
  const authorization = request.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return response.status(401).json({ error: "A Firebase Bearer token is required." });
  }

  try {
    request.user = await adminAuth.verifyIdToken(token);
    return next();
  } catch {
    return response.status(401).json({ error: "The Firebase authentication token is invalid or expired." });
  }
};

export const requireAdmin = (request, response, next) => {
  if (
    request.user?.admin !== true ||
    !ADMIN_ROLES.has(request.user?.role)
  ) {
    return response.status(403).json({ error: "Administrator access is required." });
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
      return response.status(403).json({
        error: "Your administrator role cannot perform this action.",
      });
    }
    return next();
  };
};
