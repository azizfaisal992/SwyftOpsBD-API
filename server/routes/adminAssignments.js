import { Router } from "express";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";

const router = Router();
router.use(authenticate, requireAdmin);

const isOpenRecord = (record) =>
  record.status === "active" &&
  !record.endedAt &&
  !record.clockOutAt &&
  !record.completedAt;

const newestShiftPerCaregiver = (records) => {
  const unique = new Map();
  records.forEach((shift) => {
    const key = shift.caregiverId || shift.shiftId;
    const current = unique.get(key);
    if (
      !current ||
      String(shift.updatedAt || shift.startedAt || "") >
        String(current.updatedAt || current.startedAt || "")
    ) {
      unique.set(key, shift);
    }
  });
  return [...unique.values()];
};

router.get("/", async (_request, response, next) => {
  try {
    const snapshot = await db.collection("assignments").limit(100).get();
    const records = snapshot.docs
      .map((document) => document.data())
      .sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.get("/visits", async (request, response, next) => {
  try {
    const from = String(request.query.from || "");
    const to = String(request.query.to || "");
    const caregiverId = String(request.query.caregiverId || "");
    const status = String(request.query.status || "");
    const snapshot = await db.collection("visits").limit(300).get();
    const records = snapshot.docs
      .map((document) => document.data())
      .filter((visit) =>
        (!from || visit.date >= from) &&
        (!to || visit.date <= to) &&
        (!caregiverId || visit.caregiverId === caregiverId) &&
        (!status ||
          (status === "active"
            ? isOpenRecord(visit)
            : visit.status === status)))
      .sort((a, b) =>
        `${a.date}T${a.scheduledStartLocal}`.localeCompare(
          `${b.date}T${b.scheduledStartLocal}`,
        ));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.get("/shifts", async (request, response, next) => {
  try {
    const status = String(request.query.status || "");
    const snapshot = await db.collection("caregiverShifts").limit(300).get();
    const filtered = snapshot.docs
      .map((document) => document.data())
      .filter((shift) =>
        !status ||
        (status === "active" ? isOpenRecord(shift) : shift.status === status));
    const records = (
      status === "active" ? newestShiftPerCaregiver(filtered) : filtered
    )
      .sort((a, b) =>
        String(b.updatedAt || b.startedAt)
          .localeCompare(String(a.updatedAt || a.startedAt)),
      );
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

export default router;
