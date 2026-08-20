import { Router } from "express";
import { db } from "../firebaseAdmin.js";
import { notFound } from "../errors/ApiError.js";
import {
  buildIncidentAction,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
} from "../incidentModel.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";

const router = Router();
router.use(authenticate, requireAdmin);

const getIncident = async (id) => {
  const snapshot = await db.collection("incidents").doc(id).get();
  if (!snapshot.exists) throw notFound("The incident was not found.");
  return { ...snapshot.data(), incidentId: snapshot.id };
};

const getOptionalRecord = async (collection, id) => {
  if (!id) return null;
  const snapshot = await db.collection(collection).doc(id).get();
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
};

const getProfile = async (uid) => {
  if (!uid) return null;
  const [user, caregiver, client] = await Promise.all([
    getOptionalRecord("users", uid),
    getOptionalRecord("caregiverOnboarding", uid),
    getOptionalRecord("clientOnboarding", uid),
  ]);
  const onboarding = caregiver || client;
  return {
    uid,
    name:
      onboarding?.profile?.fullName ||
      onboarding?.fullName ||
      user?.displayName ||
      user?.name ||
      user?.email ||
      "User",
    email: user?.email || onboarding?.profile?.email || "",
    role: user?.role || (caregiver ? "caregiver" : "client"),
    verificationStatus:
      onboarding?.verificationStatus || user?.verificationStatus || "pending",
    photoFile: caregiver?.files?.profilePhoto || client?.files?.profilePhoto || null,
  };
};

const enrichIncident = async (incident) => {
  const [client, caregiver, visit, transaction] = await Promise.all([
    getProfile(incident.clientId),
    getProfile(incident.caregiverId),
    getOptionalRecord("visits", incident.visitId),
    getOptionalRecord("transactions", incident.transactionId),
  ]);
  return { ...incident, client, caregiver, visit, transaction };
};

router.get("/", async (request, response, next) => {
  try {
    const status = INCIDENT_STATUSES.includes(request.query.status)
      ? request.query.status
      : "";
    const type = INCIDENT_TYPES.includes(request.query.type)
      ? request.query.type
      : "";
    const severity = ["critical", "high", "normal"].includes(
      request.query.severity,
    )
      ? request.query.severity
      : "";
    // Filter the bounded operational queue in the API so combining filters does
    // not require the project owner to create paid or manual composite indexes.
    const snapshot = await db.collection("incidents").limit(200).get();
    const incidents = snapshot.docs
      .map((document) => ({ ...document.data(), incidentId: document.id }))
      .filter(
        (incident) =>
          (!status || incident.status === status) &&
          (!type || incident.type === type) &&
          (!severity || incident.severity === severity),
      )
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
    return response.json({
      data: await enrichIncident(await getIncident(request.params.incidentId)),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:incidentId", async (request, response, next) => {
  try {
    const incident = await getIncident(request.params.incidentId);
    const update = buildIncidentAction({
      action: request.body?.action,
      body: request.body,
      incident,
      user: {
        uid: request.user.uid,
        role: request.user.role,
        name: request.user.name,
        email: request.user.email,
      },
    });
    await db.collection("incidents").doc(incident.incidentId).update(update);
    return response.json({
      data: await enrichIncident({ ...incident, ...update }),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
