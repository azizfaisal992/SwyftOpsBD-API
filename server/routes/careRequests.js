import { Router } from "express";
import { calculateAge, isCareRequestVisibleToCaregiver } from "../careRequestModel.js";
import { conflict, forbidden, notFound, validationError } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";

const router = Router();
router.use(authenticate, requireRole("caregiver"));

const requireApprovedCaregiver = async (uid) => {
  const snapshot = await db.collection("caregiverOnboarding").doc(uid).get();
  if (
    !snapshot.exists ||
    snapshot.data().verificationStatus !== "approved" ||
    snapshot.data().accountStatus === "suspended"
  ) {
    throw forbidden(
      "Caregiver verification must be approved before viewing care requests.",
    );
  }
  return snapshot.data();
};

const publicRequest = (record) => ({
  ...record,
  client: {
    fullName: record.client?.fullName,
    dateOfBirth: record.client?.dateOfBirth,
    gender: record.client?.gender,
    area: record.client?.area,
    verified: record.client?.verified === true,
    age: calculateAge(record.client?.dateOfBirth),
  },
});

router.get("/available", async (request, response, next) => {
  try {
    const caregiver = await requireApprovedCaregiver(request.user.uid);
    const snapshot = await db.collection("careRequests")
      .where("status", "==", "open")
      .limit(100)
      .get();
    const responses = await Promise.all(
      snapshot.docs.map((document) =>
        document.ref.collection("responses").doc(request.user.uid).get()),
    );
    const responded = new Set(
      responses
        .filter((document) => document.exists)
        .map((document) => document.data().requestId),
    );
    const records = snapshot.docs
      .map((document) => document.data())
      .filter((record) =>
        !responded.has(record.requestId) &&
        isCareRequestVisibleToCaregiver(record, request.user.uid) &&
        (
          record.caregiverGender === "No Preference" ||
          !caregiver.profile?.gender ||
          record.caregiverGender === caregiver.profile.gender
        ))
      .map(publicRequest)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.get("/:requestId", async (request, response, next) => {
  try {
    await requireApprovedCaregiver(request.user.uid);
    const snapshot = await db
      .collection("careRequests")
      .doc(request.params.requestId)
      .get();
    if (
      !snapshot.exists ||
      !isCareRequestVisibleToCaregiver(
        snapshot.data(),
        request.user.uid,
      )
    ) {
      return next(notFound("Care request not found."));
    }
    return response.json({ data: publicRequest(snapshot.data()) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:requestId/respond", async (request, response, next) => {
  try {
    const caregiver = await requireApprovedCaregiver(request.user.uid);
    const decision = String(request.body?.decision || "");
    if (!["accepted", "declined"].includes(decision)) {
      return next(validationError(
        "Decision must be accepted or declined.",
        { decision: "Use accepted or declined." },
      ));
    }

    const requestReference = db
      .collection("careRequests")
      .doc(request.params.requestId);
    const responseReference = requestReference
      .collection("responses")
      .doc(request.user.uid);
    let record;
    await db.runTransaction(async (transaction) => {
      const [requestSnapshot, responseSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(responseReference),
      ]);
      if (
        !requestSnapshot.exists ||
        !isCareRequestVisibleToCaregiver(
          requestSnapshot.data(),
          request.user.uid,
        )
      ) {
        throw notFound("Care request not found.");
      }
      if (responseSnapshot.exists) {
        throw conflict("You have already responded to this care request.");
      }
      const now = new Date().toISOString();
      record = {
        requestId: request.params.requestId,
        caregiverId: request.user.uid,
        caregiver: {
          fullName: caregiver.profile?.fullName || request.user.name || "",
          gender: caregiver.profile?.gender || "",
          city: caregiver.profile?.city || "",
          serviceRadius: caregiver.profile?.serviceRadius || "",
          photo: caregiver.profile?.photo || null,
        },
        decision,
        note: String(request.body?.note || "").trim().slice(0, 500),
        createdAt: now,
      };
      transaction.set(responseReference, record);
      transaction.set(requestReference, { updatedAt: now }, { merge: true });
    });
    return response.status(201).json({ data: record });
  } catch (error) {
    return next(error);
  }
});

export default router;
