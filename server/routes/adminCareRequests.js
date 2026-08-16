import { Router } from "express";
import {
  buildScheduledVisits,
  createAssignment,
} from "../assignmentModel.js";
import {
  buildCareRequest,
  CARE_REQUEST_STATUSES,
  calculateAge,
} from "../careRequestModel.js";
import { conflict, notFound, validationError } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";
import { queueCaregiverAcceptanceAdvance } from "../services/caregiverAdvanceService.js";

const router = Router();
router.use(authenticate, requireAdmin);

const requestWithAdminDetails = async (document) => {
  const request = document.data();
  const [responses, userSnapshot] = await Promise.all([
    document.ref.collection("responses").limit(100).get(),
    request.clientId
      ? db.collection("users").doc(request.clientId).get()
      : Promise.resolve(null),
  ]);
  let agreement = null;
  if (request.billingAgreementId) {
    const billingDocument = await db
      .collection("billingAgreements")
      .doc(request.billingAgreementId)
      .get();
    agreement = billingDocument.exists ? billingDocument.data() : null;
  }
  if (!agreement && request.carePlanId) {
    const billingSnapshot = await db
      .collection("billingAgreements")
      .where("carePlanId", "==", request.carePlanId)
      .limit(1)
      .get();
    agreement = billingSnapshot.docs[0]?.data() || null;
  }
  return {
    ...request,
    client: {
      ...request.client,
      age: calculateAge(request.client?.dateOfBirth),
      photoURL:
        userSnapshot?.data()?.photoURL ||
        request.client?.photoURL ||
        "",
    },
    responses: responses.docs.map((item) => item.data()),
    billing: agreement
      ? {
          agreementId: agreement.agreementId,
          total: Number(agreement.pricing?.total || 0),
          depositPercent: Number(agreement.pricing?.depositPercent || 35),
          depositAmount: Number(agreement.pricing?.depositAmount || 0),
          depositStatus: agreement.depositStatus || "pending",
          depositPaidAt: agreement.depositPaidAt || null,
        }
      : null,
  };
};

const approvedCaregivers = async () => {
  const snapshot = await db
    .collection("caregiverOnboarding")
    .where("verificationStatus", "==", "approved")
    .limit(100)
    .get();
  return snapshot.docs
    .filter((document) => document.data().accountStatus !== "suspended")
    .map((document) => ({
    caregiverId: document.id,
    fullName: document.data().profile?.fullName || "",
    gender: document.data().profile?.gender || "",
    city: document.data().profile?.city || "",
    serviceRadius: document.data().profile?.serviceRadius || "",
    photo: document.data().profile?.photo || null,
    }));
};

const matchScore = (request, caregiver, acceptedIds) => {
  let score = 50;
  if (acceptedIds.has(caregiver.caregiverId)) score += 25;
  if (request.requestedCaregiverId === caregiver.caregiverId) score += 25;
  if (
    request.caregiverGender === "No Preference" ||
    request.caregiverGender === caregiver.gender
  ) score += 15;
  if (
    request.client?.area &&
    caregiver.city &&
    request.client.area.toLowerCase().includes(caregiver.city.toLowerCase())
  ) score += 10;
  return Math.min(score, 100);
};

const reconcilePaidCareRequests = async () => {
  const paidBilling = await db
    .collection("billingAgreements")
    .where("depositStatus", "==", "paid")
    .limit(100)
    .get();
  const planIds = [...new Set(
    paidBilling.docs
      .map((document) => document.data().carePlanId)
      .filter(Boolean),
  )];
  let published = 0;

  for (const planId of planIds) {
    const [requestSnapshot, planSnapshot] = await Promise.all([
      db.collection("careRequests").doc(planId).get(),
      db.collection("carePlans").doc(planId).get(),
    ]);
    if (requestSnapshot.exists || !planSnapshot.exists) continue;

    const plan = planSnapshot.data();
    const clientSnapshot = await db
      .collection("clientOnboarding")
      .doc(plan.clientId)
      .get();
    if (
      !clientSnapshot.exists ||
      clientSnapshot.data().verificationStatus !== "approved"
    ) {
      continue;
    }

    const agreement = paidBilling.docs
      .map((document) => document.data())
      .find((record) => record.carePlanId === planId);
    const now = new Date().toISOString();
    const paidPlan = {
      ...plan,
      paymentStatus: "deposit_paid",
      billingAgreementId: agreement?.agreementId || null,
    };
    const careRequest = buildCareRequest({
      id: planId,
      plan: paidPlan,
      client: clientSnapshot.data(),
      now,
    });
    const batch = db.batch();
    batch.set(db.collection("careRequests").doc(planId), careRequest);
    batch.set(
      db.collection("carePlans").doc(planId),
      {
        status: "submitted",
        requestId: planId,
        paymentStatus: "deposit_paid",
        billingAgreementId: paidPlan.billingAgreementId,
        submittedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();
    published += 1;
  }
  return published;
};

router.get("/", async (request, response, next) => {
  try {
    const status = String(request.query.status || "");
    if (status && !CARE_REQUEST_STATUSES.includes(status)) {
      return next(validationError("Unknown care request status.", {
        status: `Use one of: ${CARE_REQUEST_STATUSES.join(", ")}.`,
      }));
    }
    let query = db.collection("careRequests");
    if (status) query = query.where("status", "==", status);
    const snapshot = await query.limit(100).get();
    const records = await Promise.all(
      snapshot.docs.map(requestWithAdminDetails),
    );
    records.sort(
      (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    );
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.post("/reconcile-paid", async (request, response, next) => {
  try {
    const published = await reconcilePaidCareRequests();
    return response.json({ data: { published } });
  } catch (error) {
    return next(error);
  }
});

router.get("/:requestId", async (request, response, next) => {
  try {
    const reference = db
      .collection("careRequests")
      .doc(request.params.requestId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return next(notFound("Care request not found."));
    const record = await requestWithAdminDetails(snapshot);
    const caregivers = await approvedCaregivers();
    const acceptedIds = new Set(
      record.responses
        .filter((item) => item.decision === "accepted")
        .map((item) => item.caregiverId),
    );
    const matches = caregivers
      .map((caregiver) => ({
        ...caregiver,
        score: matchScore(record, caregiver, acceptedIds),
        responded: acceptedIds.has(caregiver.caregiverId),
      }))
      .sort((a, b) => b.score - a.score);
    return response.json({ data: { ...record, matches } });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:requestId", async (request, response, next) => {
  try {
    const action = String(request.body?.action || "");
    if (!["hold", "reopen", "decline", "assign", "auto_match"].includes(action)) {
      return next(validationError("Unknown care request action.", {
        action: "Use hold, reopen, decline, assign or auto_match.",
      }));
    }
    const reference = db
      .collection("careRequests")
      .doc(request.params.requestId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return next(notFound("Care request not found."));
    const current = snapshot.data();
    if (["declined", "cancelled"].includes(current.status)) {
      return next(conflict("This care request is already finalized."));
    }
    if (
      current.status === "assigned" &&
      !["assign", "auto_match"].includes(action)
    ) {
      return next(conflict(
        "An assigned request can only be reassigned to another caregiver.",
      ));
    }

    const now = new Date().toISOString();
    let update = { updatedAt: now };
    let assignment = null;
    let scheduledVisits = [];
    if (action === "hold") update = { ...update, status: "held", heldAt: now };
    if (action === "reopen") update = { ...update, status: "open", heldAt: null };
    if (action === "decline") {
      update = {
        ...update,
        status: "declined",
        declinedAt: now,
        declineReason: String(request.body?.reason || "").trim().slice(0, 500),
      };
    }
    if (["assign", "auto_match"].includes(action)) {
      let caregiverId = String(request.body?.caregiverId || "");
      if (!caregiverId && action === "auto_match") {
        const detail = await requestWithAdminDetails(snapshot);
        const accepted = detail.responses.find(
          (item) => item.decision === "accepted",
        );
        caregiverId = accepted?.caregiverId || current.requestedCaregiverId || "";
        if (!caregiverId) {
          const caregivers = await approvedCaregivers();
          caregiverId = caregivers[0]?.caregiverId || "";
        }
      }
      if (!caregiverId) {
        return next(validationError(
          "Select an approved caregiver before assigning.",
          { caregiverId: "Caregiver is required." },
        ));
      }
      const caregiverSnapshot = await db
        .collection("caregiverOnboarding")
        .doc(caregiverId)
        .get();
      if (
        !caregiverSnapshot.exists ||
        caregiverSnapshot.data().verificationStatus !== "approved" ||
        caregiverSnapshot.data().accountStatus === "suspended"
      ) {
        return next(validationError(
          "Only an approved caregiver can be assigned.",
          { caregiverId: "Select an approved caregiver." },
        ));
      }
      update = {
        ...update,
        status: "assigned",
        assignedCaregiverId: caregiverId,
        assignedCaregiver: {
          fullName: caregiverSnapshot.data().profile?.fullName || "",
          phone: caregiverSnapshot.data().profile?.phone || "",
          photo: caregiverSnapshot.data().profile?.photo || null,
        },
        assignedAt: now,
        assignedBy: request.user.uid,
      };
      const caregiverResponse = await reference
        .collection("responses")
        .doc(caregiverId)
        .get();
      assignment = createAssignment({
        request: current,
        caregiver: caregiverSnapshot.data(),
        caregiverId,
        accepted:
          caregiverResponse.exists &&
          caregiverResponse.data().decision === "accepted",
        assignedBy: request.user.uid,
        now,
      });
      scheduledVisits = buildScheduledVisits({ assignment });
    }
    if (assignment) {
      const billingSnapshot = current.carePlanId
        ? await db.collection("billingAgreements")
          .where("carePlanId", "==", current.carePlanId)
          .limit(5)
          .get()
        : null;
      const batch = db.batch();
      batch.set(reference, update, { merge: true });
      batch.set(
        db.collection("assignments").doc(assignment.assignmentId),
        assignment,
      );
      scheduledVisits.forEach((visit) => {
        batch.set(db.collection("visits").doc(visit.visitId), visit);
      });
      if (current.carePlanId) {
        batch.set(
          db.collection("carePlans").doc(current.carePlanId),
          {
            status: "assigned",
            assignedCaregiverId: assignment.caregiverId,
            assignmentId: assignment.assignmentId,
            assignedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }
      billingSnapshot?.docs.forEach((document) => {
        const billing = document.data();
        batch.set(document.ref, {
          assignmentId: assignment.assignmentId,
          caregiverId: assignment.caregiverId,
          caregiverName: assignment.caregiver?.fullName || "",
          serviceStatus: "scheduled",
          status: "service_scheduled",
          updatedAt: now,
        }, { merge: true });
        if (billing.depositInvoiceId) {
          batch.set(db.collection("invoices").doc(billing.depositInvoiceId), {
            assignmentId: assignment.assignmentId,
            updatedAt: now,
          }, { merge: true });
        }
        if (billing.balanceInvoiceId) {
          batch.set(db.collection("invoices").doc(billing.balanceInvoiceId), {
            assignmentId: assignment.assignmentId,
            updatedAt: now,
          }, { merge: true });
        }
      });
      if (assignment.status === "confirmed") {
        await queueCaregiverAcceptanceAdvance({
          db,
          batch,
          assignment,
          now,
        });
      }
      await batch.commit();
    } else {
      await reference.set(update, { merge: true });
    }
    return response.json({
      data: {
        ...current,
        ...update,
        assignment,
        scheduledVisits: scheduledVisits.length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
