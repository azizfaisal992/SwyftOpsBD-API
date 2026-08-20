import { Router } from "express";
import { db } from "../firebaseAdmin.js";
import { forbidden, notFound } from "../errors/ApiError.js";
import { buildIncident } from "../incidentModel.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";

const router = Router();
router.use(authenticate, requireRole("client", "caregiver"));

const record = (snapshot) =>
  snapshot.exists ? { ...snapshot.data(), incidentId: snapshot.id } : null;

const getOwnedVisit = async (visitId, user) => {
  if (!visitId) return null;
  const snapshot = await db.collection("visits").doc(visitId).get();
  if (!snapshot.exists) throw notFound("The linked visit was not found.");
  const visit = { ...snapshot.data(), visitId: snapshot.id };
  const owner =
    (user.role === "client" && visit.clientId === user.uid) ||
    (user.role === "caregiver" && visit.caregiverId === user.uid);
  if (!owner) throw forbidden("You cannot report an incident for this visit.");
  return visit;
};

const getOwnedTransaction = async (transactionId, user) => {
  if (!transactionId) return null;
  const snapshot = await db.collection("transactions").doc(transactionId).get();
  if (!snapshot.exists) throw notFound("The linked transaction was not found.");
  const transaction = { ...snapshot.data(), transactionId: snapshot.id };
  const owner =
    transaction.clientId === user.uid || transaction.caregiverId === user.uid;
  if (!owner) {
    throw forbidden("You cannot report an incident for this transaction.");
  }
  return transaction;
};

router.get("/mine", async (request, response, next) => {
  try {
    const field = request.user.role === "client" ? "clientId" : "caregiverId";
    const snapshot = await db
      .collection("incidents")
      .where(field, "==", request.user.uid)
      .limit(100)
      .get();
    const incidents = snapshot.docs
      .map((document) => ({ ...document.data(), incidentId: document.id }))
      .sort((left, right) =>
        String(right.createdAt || "").localeCompare(String(left.createdAt || "")),
      );
    return response.json({ data: incidents });
  } catch (error) {
    return next(error);
  }
});

router.get("/:incidentId", async (request, response, next) => {
  try {
    const incident = record(
      await db.collection("incidents").doc(request.params.incidentId).get(),
    );
    if (!incident) throw notFound("The incident was not found.");
    if (
      incident.clientId !== request.user.uid &&
      incident.caregiverId !== request.user.uid
    ) {
      throw forbidden("You cannot access this incident.");
    }
    return response.json({ data: incident });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (request, response, next) => {
  try {
    const [visit, transaction] = await Promise.all([
      getOwnedVisit(request.body?.visitId, request.user),
      getOwnedTransaction(request.body?.transactionId, request.user),
    ]);
    const reference = db.collection("incidents").doc();
    const incident = buildIncident({
      body: request.body,
      id: reference.id,
      reporter: {
        uid: request.user.uid,
        role: request.user.role,
        name: request.user.name,
        email: request.user.email,
      },
      visit,
      transaction,
    });
    await reference.set(incident);
    return response.status(201).json({ data: incident });
  } catch (error) {
    return next(error);
  }
});

export default router;
