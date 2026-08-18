import { Router } from "express";
import { conflict, forbidden, notFound } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  completeVisit,
  completeShift,
  startShift,
  updateShiftLocation,
} from "../visitExecutionModel.js";

const router = Router();
router.use(authenticate);
router.use((request, _response, next) => {
  if (request.user.role !== "caregiver") {
    return next(forbidden("Only caregivers can use the shift clock."));
  }
  return next();
});

const caregiverShifts = async (caregiverId) => {
  const snapshot = await db
    .collection("caregiverShifts")
    .where("caregiverId", "==", caregiverId)
    .limit(200)
    .get();
  return snapshot.docs.map((document) => ({
    ...document.data(),
    shiftId: document.data().shiftId || document.id,
  }));
};

const caregiverVisits = async (caregiverId) => {
  const snapshot = await db
    .collection("visits")
    .where("caregiverId", "==", caregiverId)
    .limit(200)
    .get();
  return snapshot.docs.map((document) => ({
    reference: document.ref,
    visit: {
      ...document.data(),
      visitId: document.data().visitId || document.id,
    },
  }));
};

router.get("/mine", async (request, response, next) => {
  try {
    const from = String(request.query.from || "");
    const to = String(request.query.to || "");
    const shifts = (await caregiverShifts(request.user.uid))
      .filter((shift) =>
        (!from || shift.startedAt >= from) &&
        (!to || shift.startedAt <= to))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return response.json({ data: shifts });
  } catch (error) {
    return next(error);
  }
});

router.get("/active", async (request, response, next) => {
  try {
    const shift = (await caregiverShifts(request.user.uid))
      .find((record) => record.status === "active") || null;
    return response.json({ data: shift });
  } catch (error) {
    return next(error);
  }
});

router.post("/clock-in", async (request, response, next) => {
  try {
    const active = (await caregiverShifts(request.user.uid))
      .find((record) => record.status === "active");
    if (active) return next(conflict("A caregiver shift is already active."));
    const now = new Date().toISOString();
    const shiftId = `${request.user.uid}_${Date.now()}`;
    const shift = startShift({
      caregiverId: request.user.uid,
      caregiverName: request.user.name || request.user.email || "",
      location: request.body.location,
      now,
      shiftId,
    });
    await db.collection("caregiverShifts").doc(shiftId).set(shift);
    return response.status(201).json({ data: shift });
  } catch (error) {
    return next(error);
  }
});

router.post("/clock-out", async (request, response, next) => {
  try {
    const activeShifts = (await caregiverShifts(request.user.uid))
      .filter((record) => record.status === "active");
    if (!activeShifts.length) {
      return next(notFound("No active caregiver shift was found."));
    }

    const now = new Date().toISOString();
    const completedShifts = activeShifts.map((shift) =>
      completeShift(shift, {
        location: request.body.location,
        now,
      }));
    const activeVisits = (await caregiverVisits(request.user.uid))
      .filter(({ visit }) => visit.status === "active");
    const completedVisits = activeVisits.map(({ reference, visit }) => ({
      reference,
      visit: completeVisit(visit, {
        completedTasks: visit.completedTasks || [],
        careNotes: visit.careNotes || "",
        location: request.body.location,
        now,
      }),
    }));

    const batch = db.batch();
    completedShifts.forEach((shift) => {
      batch.set(db.collection("caregiverShifts").doc(shift.shiftId), shift);
    });
    completedVisits.forEach(({ reference, visit }) => {
      batch.set(reference, {
        ...visit,
        completionSource: "caregiver_shift_clock_out",
      });
      if (visit.assignmentId) {
        batch.set(
          db.collection("assignments").doc(visit.assignmentId),
          { status: "confirmed", updatedAt: now },
          { merge: true },
        );
      }
    });
    await batch.commit();

    return response.json({
      data: {
        ...completedShifts[0],
        reconciledShiftCount: completedShifts.length,
        completedVisitCount: completedVisits.length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/location", async (request, response, next) => {
  try {
    const active = (await caregiverShifts(request.user.uid))
      .find((record) => record.status === "active");
    if (!active) return next(notFound("No active caregiver shift was found."));
    const updated = updateShiftLocation(active, {
      location: request.body.location,
    });
    await db.collection("caregiverShifts").doc(active.shiftId).set(updated);
    return response.json({ data: updated });
  } catch (error) {
    return next(error);
  }
});

export default router;
