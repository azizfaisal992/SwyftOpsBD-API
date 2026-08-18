import { Router } from "express";
import { adminAuth, db } from "../firebaseAdmin.js";
import { authenticate, requireAdminRole } from "../middleware/authenticate.js";
import { createUserRepository } from "../repositories/userRepository.js";
import { createIdentityService } from "../services/identityService.js";
import { requireObjectBody } from "../validation/index.js";
import { ADMIN_ROLES } from "../config/roles.js";

const router = Router();
const identityService = createIdentityService({
  repository: createUserRepository(db),
  authentication: adminAuth,
});

const respond = (request, response, data) =>
  response.json({
    data,
    meta: {
      requestId: request.id,
      timestamp: new Date().toISOString(),
    },
  });

router.use(authenticate, requireAdminRole("super_admin"));

const ADMIN_CACHE_TTL_MS = 60_000;
let administratorCache = { expiresAt: 0, data: null };

const clearAdministratorCache = () => {
  administratorCache = { expiresAt: 0, data: null };
};

const loadAdministrators = async () => {
  if (
    administratorCache.data &&
    administratorCache.expiresAt > Date.now()
  ) return administratorCache.data;

  // Read only likely administrators from Firestore, then validate their
  // privileged custom claims with one Firebase Authentication batch request.
  // This avoids scanning the complete Firebase user directory on every load.
  const snapshot = await db.collection("users")
    .where("role", "in", ADMIN_ROLES)
    .limit(100)
    .get();
  if (snapshot.empty) {
    administratorCache = {
      expiresAt: Date.now() + ADMIN_CACHE_TTL_MS,
      data: [],
    };
    return [];
  }
  const accounts = new Map(
    snapshot.docs.map((document) => [document.id, document.data()]),
  );
  const authenticationResults = await Promise.allSettled(
    snapshot.docs.map((document) => adminAuth.getUser(document.id)),
  );
  const authenticationUsers = authenticationResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const data = authenticationUsers
    .filter((user) =>
      user.customClaims?.admin === true &&
      ADMIN_ROLES.includes(user.customClaims?.role),
    )
    .map((user) => {
      const account = accounts.get(user.uid) || {};
      return {
        uid: user.uid,
        name:
          account.displayName ||
          user.displayName ||
          user.email?.split("@")[0] ||
          "Administrator",
        email: user.email || account.email || "",
        photoURL: account.photoURL || user.photoURL || "",
        role: user.customClaims.role,
        active: !user.disabled && !["suspended", "disabled"]
          .includes(account.status),
        emailVerified: user.emailVerified,
        lastLoginAt: user.metadata.lastSignInTime || null,
        createdAt: user.metadata.creationTime || null,
      };
    });
  administratorCache = {
    expiresAt: Date.now() + ADMIN_CACHE_TTL_MS,
    data,
  };
  return data;
};

router.get("/", async (request, response, next) => {
  try {
    response.set("Cache-Control", "private, max-age=30");
    return respond(request, response, await loadAdministrators());
  } catch (error) {
    return next(error);
  }
});

router.post("/:uid/claims", async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    const result = await identityService.setAdministratorClaims(
      request.params.uid,
      String(request.body.role || "").trim(),
      request.user.uid,
    );
    clearAdministratorCache();
    return respond(
      request,
      response,
      result,
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/:uid/revoke-sessions", async (request, response, next) => {
  try {
    const result = await identityService.revokeSessions(
      request.params.uid,
      request.user.uid,
    );
    clearAdministratorCache();
    return respond(
      request,
      response,
      result,
    );
  } catch (error) {
    return next(error);
  }
});

export default router;
