import { adminAuth } from "../firebaseAdmin.js";

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
  if (!request.user?.admin) {
    return response.status(403).json({ error: "Administrator access is required." });
  }
  return next();
};
