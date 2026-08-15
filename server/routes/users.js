import { Router } from "express";
import { adminAuth, db } from "../firebaseAdmin.js";
import { authenticate } from "../middleware/authenticate.js";
import { createUserRepository } from "../repositories/userRepository.js";
import { createIdentityService } from "../services/identityService.js";
import { requireObjectBody } from "../validation/index.js";

const router = Router();
const identityService = createIdentityService({
  repository: createUserRepository(db),
  authentication: adminAuth,
});

const respond = (request, response, data, status = 200) =>
  response.status(status).json({
    data,
    meta: {
      requestId: request.id,
      timestamp: new Date().toISOString(),
    },
  });

router.use(authenticate);

router.post("/bootstrap", async (request, response, next) => {
  try {
    return respond(
      request,
      response,
      await identityService.bootstrap(request.user),
      201,
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/me", async (request, response, next) => {
  try {
    return respond(
      request,
      response,
      await identityService.getCurrentAccount(request.user.uid),
    );
  } catch (error) {
    return next(error);
  }
});

router.patch("/me", async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    return respond(
      request,
      response,
      await identityService.updateCurrentAccount(request.user.uid, request.body),
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/me/account-type", async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    return respond(
      request,
      response,
      await identityService.selectAccountType(
        request.user.uid,
        String(request.body.role || "").trim(),
      ),
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/me/permissions", async (request, response, next) => {
  try {
    return respond(
      request,
      response,
      await identityService.getPermissions(request.user.uid),
    );
  } catch (error) {
    return next(error);
  }
});

export default router;
