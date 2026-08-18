import { Router } from "express";
import { conflict, forbidden, notFound } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  completeVisit,
  startVisit,
  updateVisitLocation,
  updateVisitProgress,
} from "../visitExecutionModel.js";

const router = Router();
router.use(authenticate);

const roleField = (user) => {
  if (user.role === "client") return "clientId";
  if (user.role === "caregiver") return "caregiverId";
  throw forbidden("Only client and caregiver accounts can access visits.");
};

const ownedVisit = async (visitId, user) => {
  const reference = db.collection("visits").doc(visitId);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw notFound("Visit not found.");
  const visit = snapshot.data();
  if (visit[roleField(user)] !== user.uid) throw notFound("Visit not found.");
  return { reference, visit };
};

const requireCaregiver = (user) => {
  if (user.role !== "caregiver") {
    throw forbidden("Only the assigned caregiver can update a visit.");
  }
};

router.get("/mine", async (request, response, next) => {
  try {
    const field = roleField(request.user);
    const status = String(request.query.status || "");
    const snapshot = await db
      .collection("visits")
      .where(field, "==", request.user.uid)
      .limit(200)
      .get();
    const visits = snapshot.docs
      .map((document) => document.data())
      .filter((visit) => !status || visit.status === status)
      .sort((a, b) =>
        `${a.date}T${a.scheduledStartLocal}`.localeCompare(
          `${b.date}T${b.scheduledStartLocal}`,
        ));
    return response.json({ data: visits });
  } catch (error) {
    return next(error);
  }
});

router.get("/active/mine", async (request, response, next) => {
  try {
    const field = roleField(request.user);
    const snapshot = await db
      .collection("visits")
      .where(field, "==", request.user.uid)
      .limit(200)
      .get();
    const visit = snapshot.docs
      .map((document) => document.data())
      .find((record) => record.status === "active") || null;
    return response.json({ data: visit });
  } catch (error) {
    return next(error);
  }
});

router.get("/:visitId", async (request, response, next) => {
  try {
    const { visit } = await ownedVisit(request.params.visitId, request.user);
    return response.json({ data: visit });
  } catch (error) {
    return next(error);
  }
});

router.post("/:visitId/clock-in", async (request, response, next) => {
  try {
    requireCaregiver(request.user);
    const { reference, visit } = await ownedVisit(
      request.params.visitId,
      request.user,
    );
    if (visit.status !== "active") {
      const snapshot = await db
        .collection("visits")
        .where("caregiverId", "==", request.user.uid)
        .limit(200)
        .get();
      const otherActiveVisit = snapshot.docs
        .map((document) => document.data())
        .find((record) =>
          record.status === "active" && record.visitId !== visit.visitId);
      if (otherActiveVisit) {
        return next(conflict(
          "Clock out of the current active visit before starting another.",
        ));
      }
    }
    const updated = startVisit(visit, {
      location: request.body.location,
    });
    const batch = db.batch();
    batch.set(reference, updated);
    batch.set(
      db.collection("assignments").doc(visit.assignmentId),
      { status: "active", updatedAt: updated.updatedAt },
      { merge: true },
    );
    await batch.commit();
    return response.json({ data: updated });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:visitId/progress", async (request, response, next) => {
  try {
    requireCaregiver(request.user);
    const { reference, visit } = await ownedVisit(
      request.params.visitId,
      request.user,
    );
    const updated = updateVisitProgress(visit, request.body);
    await reference.set(updated);
    return response.json({ data: updated });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:visitId/location", async (request, response, next) => {
  try {
    requireCaregiver(request.user);
    const { reference, visit } = await ownedVisit(
      request.params.visitId,
      request.user,
    );
    const updated = updateVisitLocation(visit, {
      location: request.body.location,
    });
    await reference.set(updated);
    return response.json({ data: updated });
  } catch (error) {
    return next(error);
  }
});

router.post("/:visitId/complete", async (request, response, next) => {
  try {
    requireCaregiver(request.user);
    const { reference, visit } = await ownedVisit(
      request.params.visitId,
      request.user,
    );
    const updated = completeVisit(visit, request.body);
    const batch = db.batch();
    batch.set(reference, updated);
    batch.set(
      db.collection("assignments").doc(visit.assignmentId),
      { status: "confirmed", updatedAt: updated.updatedAt },
      { merge: true },
    );
    await batch.commit();
    const assignmentVisits = await db.collection("visits")
      .where("assignmentId", "==", visit.assignmentId)
      .limit(500)
      .get();
    const allCompleted = assignmentVisits.docs
      .map((document) =>
        document.id === updated.visitId ? updated : document.data())
      .every((record) => record.status === "completed");
    if (allCompleted) {
      const agreementSnapshot = await db.collection("billingAgreements")
        .where("assignmentId", "==", visit.assignmentId)
        .limit(5)
        .get();
      if (!agreementSnapshot.empty) {
        const now = updated.updatedAt;
        const completionBatch = db.batch();
        agreementSnapshot.docs.forEach((document) => {
          const agreement = document.data();
          completionBatch.set(document.ref, {
            serviceStatus: "completed",
            serviceCompletedAt: now,
            status: "balance_due",
            balanceStatus: "pending",
            updatedAt: now,
          }, { merge: true });
          if (agreement.balanceInvoiceId) {
            completionBatch.set(
              db.collection("invoices").doc(agreement.balanceInvoiceId),
              { status: "pending", updatedAt: now },
              { merge: true },
            );
          }
          if (agreement.carePlanId) {
            completionBatch.set(
              db.collection("carePlans").doc(agreement.carePlanId),
              { paymentStatus: "balance_due", updatedAt: now },
              { merge: true },
            );
          }
        });
        await completionBatch.commit();
      }
    }
    return response.json({ data: updated });
  } catch (error) {
    return next(error);
  }
});

export default router;
