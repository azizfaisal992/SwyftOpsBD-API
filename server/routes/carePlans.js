import { Router } from "express";
import {
  buildCareRequest,
  createCarePlan,
  sanitizeCarePlan,
  validateCarePlan,
} from "../careRequestModel.js";
import { conflict, forbidden, notFound, validationError } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";

const router = Router();
router.use(authenticate, requireRole("client"));

const carePlans = () => db.collection("carePlans");
const clientOnboarding = (uid) =>
  db.collection("clientOnboarding").doc(uid);

const requireSubmittedClient = async (uid) => {
  const snapshot = await clientOnboarding(uid).get();
  if (!snapshot.exists || snapshot.data().submitted !== true) {
    throw forbidden(
      "Complete and submit client onboarding before creating a care plan.",
    );
  }
  return snapshot.data();
};

const requireOwnedPlan = async (planId, clientId) => {
  const reference = carePlans().doc(planId);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data().clientId !== clientId) {
    throw notFound("Care plan not found.");
  }
  return { reference, plan: snapshot.data() };
};

router.get("/", async (request, response, next) => {
  try {
    const snapshot = await carePlans()
      .where("clientId", "==", request.user.uid)
      .limit(100)
      .get();
    const records = snapshot.docs
      .map((document) => document.data())
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.get("/requests/mine", async (request, response, next) => {
  try {
    const snapshot = await db
      .collection("careRequests")
      .where("clientId", "==", request.user.uid)
      .limit(100)
      .get();
    const records = snapshot.docs
      .map((document) => document.data())
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (request, response, next) => {
  try {
    await requireSubmittedClient(request.user.uid);
    const data = sanitizeCarePlan(request.body);
    const fields = validateCarePlan(data);
    if (Object.keys(fields).length) {
      return next(validationError("Correct the care plan fields.", fields));
    }

    const reference = carePlans().doc();
    const plan = {
      carePlanId: reference.id,
      ...createCarePlan({ clientId: request.user.uid, data }),
    };
    await reference.set(plan);
    return response.status(201).json({ data: plan });
  } catch (error) {
    return next(error);
  }
});

router.get("/:planId", async (request, response, next) => {
  try {
    const { plan } = await requireOwnedPlan(
      request.params.planId,
      request.user.uid,
    );
    return response.json({ data: plan });
  } catch (error) {
    return next(error);
  }
});

router.put("/:planId", async (request, response, next) => {
  try {
    const { reference, plan: current } = await requireOwnedPlan(
      request.params.planId,
      request.user.uid,
    );
    if (current.status !== "draft") {
      return next(conflict("A submitted care plan cannot be edited."));
    }
    const data = sanitizeCarePlan(request.body);
    const fields = validateCarePlan(data);
    if (Object.keys(fields).length) {
      return next(validationError("Correct the care plan fields.", fields));
    }
    const plan = {
      ...current,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await reference.set(plan);
    return response.json({ data: plan });
  } catch (error) {
    return next(error);
  }
});

router.post("/:planId/submit", async (request, response, next) => {
  try {
    const clientSnapshot = await clientOnboarding(request.user.uid).get();
    if (
      !clientSnapshot.exists ||
      clientSnapshot.data().verificationStatus !== "approved"
    ) {
      return next(forbidden(
        "Client verification must be approved before publishing a care request.",
      ));
    }

    const billingSnapshot = await db.collection("billingAgreements")
      .where("carePlanId", "==", request.params.planId)
      .limit(5)
      .get();
    const billing = billingSnapshot.docs
      .map((document) => document.data())
      .find((record) => record.clientId === request.user.uid);
    if (!billing || billing.depositStatus !== "paid") {
      return next(forbidden(
        "Pay the 35% booking deposit before publishing this care request.",
      ));
    }

    const planReference = carePlans().doc(request.params.planId);
    const requestReference = db
      .collection("careRequests")
      .doc(request.params.planId);
    let publishedRequest;

    await db.runTransaction(async (transaction) => {
      const planSnapshot = await transaction.get(planReference);
      if (
        !planSnapshot.exists ||
        planSnapshot.data().clientId !== request.user.uid
      ) {
        throw notFound("Care plan not found.");
      }
      const plan = planSnapshot.data();
      if (plan.status === "submitted" && plan.requestId) {
        const existing = await transaction.get(requestReference);
        publishedRequest = existing.exists ? existing.data() : null;
        return;
      }
      if (plan.status !== "draft") {
        throw conflict("This care plan cannot be submitted.");
      }

      const now = new Date().toISOString();
      publishedRequest = buildCareRequest({
        id: requestReference.id,
        plan: {
          ...plan,
          paymentStatus: "deposit_paid",
          billingAgreementId: billing.agreementId,
        },
        client: clientSnapshot.data(),
        now,
      });
      transaction.set(requestReference, publishedRequest);
      transaction.set(planReference, {
        ...plan,
        status: "submitted",
        requestId: requestReference.id,
        billingAgreementId: billing.agreementId,
        paymentStatus: "deposit_paid",
        submittedAt: now,
        updatedAt: now,
      });
    });

    if (!publishedRequest) {
      const existing = await requestReference.get();
      publishedRequest = existing.data();
    }
    return response.status(201).json({ data: publishedRequest });
  } catch (error) {
    return next(error);
  }
});

export default router;
