import { Router } from "express";
import { conflict, forbidden, notFound } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate } from "../middleware/authenticate.js";
import { readPrivateFile } from "../services/fileStorage.js";
import { queueCaregiverAcceptanceAdvance } from "../services/caregiverAdvanceService.js";

const router = Router();
router.use(authenticate);

const roleField = (user) => {
  if (user.role === "client") return "clientId";
  if (user.role === "caregiver") return "caregiverId";
  throw forbidden("Only client and caregiver accounts can access assignments.");
};

const ownedAssignment = async (assignmentId, user) => {
  const reference = db.collection("assignments").doc(assignmentId);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw notFound("Assignment not found.");
  const assignment = snapshot.data();
  const field = roleField(user);
  if (assignment[field] !== user.uid) throw notFound("Assignment not found.");
  return { reference, assignment };
};

router.get("/mine", async (request, response, next) => {
  try {
    const field = roleField(request.user);
    const snapshot = await db
      .collection("assignments")
      .where(field, "==", request.user.uid)
      .limit(100)
      .get();
    const records = snapshot.docs
      .map((document) => document.data())
      .sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.get("/visits/mine", async (request, response, next) => {
  try {
    const field = roleField(request.user);
    const from = String(request.query.from || "");
    const to = String(request.query.to || "");
    const snapshot = await db
      .collection("visits")
      .where(field, "==", request.user.uid)
      .limit(200)
      .get();
    const records = snapshot.docs
      .map((document) => document.data())
      .filter((visit) => (!from || visit.date >= from) && (!to || visit.date <= to))
      .sort((a, b) =>
        `${a.date}T${a.scheduledStartLocal}`.localeCompare(
          `${b.date}T${b.scheduledStartLocal}`,
        ));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.get("/attendance/mine", async (request, response, next) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden(
        "Only clients can view the assigned-caregiver attendance summary.",
      ));
    }
    const [visitSnapshot, assignmentSnapshot, activeShiftSnapshot] =
      await Promise.all([
        db.collection("visits")
          .where("clientId", "==", request.user.uid)
          .limit(500)
          .get(),
        db.collection("assignments")
          .where("clientId", "==", request.user.uid)
          .limit(100)
          .get(),
        db.collection("caregiverShifts")
          .where("status", "==", "active")
          .limit(200)
          .get(),
      ]);

    const assignments = assignmentSnapshot.docs
      .map((document) => document.data())
      .filter((assignment) => assignment.status !== "cancelled");
    const currentAssignments = assignments.filter((assignment) =>
      ["confirmed", "active"].includes(assignment.status),
    );
    const caregiverAssignments = new Map(
      currentAssignments.map((assignment) => [
        assignment.caregiverId,
        assignment,
      ]),
    );
    const activeShifts = activeShiftSnapshot.docs
      .map((document) => document.data())
      .filter((shift) => caregiverAssignments.has(shift.caregiverId))
      .map((shift) => {
        const assignment = caregiverAssignments.get(shift.caregiverId);
        return {
          shiftId: shift.shiftId,
          caregiverId: shift.caregiverId,
          caregiverName:
            assignment.caregiver?.fullName ||
            shift.caregiverName ||
            "Assigned caregiver",
          startedAt: shift.startedAt,
          status: "active",
        };
      });

    const visits = visitSnapshot.docs
      .map((document) => {
        const visit = document.data();
        const verified =
          visit.status === "completed" &&
          Boolean(visit.clockInAt) &&
          Boolean(visit.clockOutAt) &&
          Number(visit.durationSeconds || 0) > 0;
        return {
          visitId: visit.visitId || document.id,
          assignmentId: visit.assignmentId,
          caregiverId: visit.caregiverId,
          caregiverName: visit.caregiverName || "Assigned caregiver",
          careType: visit.careType || "",
          date: visit.date,
          scheduledStartLocal: visit.scheduledStartLocal || "",
          scheduledEndLocal: visit.scheduledEndLocal || "",
          status: visit.status,
          clockInAt: visit.clockInAt || null,
          clockOutAt: visit.clockOutAt || null,
          durationSeconds: Number(visit.durationSeconds || 0),
          verified,
          withinGeofence:
            typeof visit.withinGeofence === "boolean"
              ? visit.withinGeofence
              : null,
          activeLocation:
            visit.status === "active"
              ? visit.currentLocation || visit.clockInLocation || null
              : null,
        };
      })
      .sort((left, right) =>
        `${left.date}T${left.scheduledStartLocal}`.localeCompare(
          `${right.date}T${right.scheduledStartLocal}`,
        ),
      );
    const completedVisits = visits.filter(
      (visit) => visit.status === "completed",
    );
    const verifiedVisits = completedVisits.filter((visit) => visit.verified);
    const currentAssignmentIds = new Set(
      currentAssignments.map((assignment) => assignment.assignmentId),
    );
    const activeVisit =
      visits.find(
        (visit) =>
          visit.status === "active" &&
          currentAssignmentIds.has(visit.assignmentId),
      ) || null;
    const totalSeconds = verifiedVisits.reduce(
      (sum, visit) => sum + visit.durationSeconds,
      0,
    );

    return response.json({
      data: {
        totalHours: Math.round((totalSeconds / 3600) * 100) / 100,
        completedVisits: completedVisits.length,
        verifiedVisits: verifiedVisits.length,
        scheduledVisits: visits.filter(
          (visit) => visit.status === "scheduled",
        ).length,
        currentStatus: activeVisit
          ? "on_visit"
          : activeShifts.length
            ? "on_duty"
            : "off_duty",
        activeVisit,
        activeCaregiverShifts: activeShifts,
        activeAssignments: currentAssignments.length,
        servicePeriods: assignments.map((assignment) => ({
          assignmentId: assignment.assignmentId,
          caregiverName:
            assignment.caregiver?.fullName || "Assigned caregiver",
          careType: assignment.careType || "",
          serviceStartDate: assignment.serviceStartDate || null,
          serviceEndDate: assignment.serviceEndDate || null,
          status: assignment.status,
        })),
        visits,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:assignmentId/caregiver-verification", async (request, response, next) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden(
        "Only the assigned client can view caregiver verification details.",
      ));
    }
    const { assignment } = await ownedAssignment(
      request.params.assignmentId,
      request.user,
    );
    const snapshot = await db
      .collection("caregiverOnboarding")
      .doc(assignment.caregiverId)
      .get();
    if (!snapshot.exists) {
      return next(notFound("The assigned caregiver verification was not found."));
    }
    const onboarding = snapshot.data();
    const licenses = onboarding.credentials?.licenses || {};
    const licenseSummary = Object.entries(licenses)
      .filter(([, metadata]) => Boolean(metadata?.storagePath))
      .map(([kind, metadata]) => ({
        kind,
        label: {
          CRP: "CRP professional license",
          AHLC: "AHLC care license",
          RNLC: "Registered nursing license",
        }[kind] || `${kind} license`,
        uploadedAt: metadata.uploadedAt || null,
        verified: onboarding.verificationStatus === "approved",
      }));
    const history = [
      onboarding.submittedAt
        ? {
            event: "onboarding_submitted",
            title: "Verification submitted",
            occurredAt: onboarding.submittedAt,
          }
        : null,
      onboarding.reviewedAt
        ? {
            event: "admin_review_completed",
            title:
              onboarding.verificationStatus === "approved"
                ? "Administrator verification approved"
                : "Administrator review completed",
            occurredAt: onboarding.reviewedAt,
          }
        : null,
      assignment.assignedAt
        ? {
            event: "assigned_to_client",
            title: "Assigned to your care plan",
            occurredAt: assignment.assignedAt,
          }
        : null,
    ].filter(Boolean);

    return response.json({
      data: {
        assignmentId: assignment.assignmentId,
        caregiverId: assignment.caregiverId,
        assignmentStatus: assignment.status,
        profile: {
          fullName:
            onboarding.profile?.fullName ||
            assignment.caregiver?.fullName ||
            "Assigned caregiver",
          gender: onboarding.profile?.gender || "",
          city: onboarding.profile?.city || "",
          photoAvailable: Boolean(onboarding.profile?.photo?.storagePath),
        },
        verification: {
          status: onboarding.verificationStatus || "draft",
          submittedAt: onboarding.submittedAt || null,
          reviewedAt: onboarding.reviewedAt || null,
          profileCompleted: onboarding.profileCompleted === true,
          credentialsCompleted: onboarding.credentialsCompleted === true,
          assessmentSubmitted: onboarding.assessmentSubmitted === true,
          progress: Number(onboarding.progress || 0),
          identityDocuments: {
            nidFrontReviewed: Boolean(
              onboarding.credentials?.nidFront?.storagePath &&
                onboarding.verificationStatus === "approved",
            ),
            nidBackReviewed: Boolean(
              onboarding.credentials?.nidBack?.storagePath &&
                onboarding.verificationStatus === "approved",
            ),
          },
          resumeReviewed: Boolean(
            onboarding.credentials?.resume?.storagePath &&
              onboarding.verificationStatus === "approved",
          ),
          referenceLetterReviewed: Boolean(
            onboarding.credentials?.referenceLetter?.storagePath &&
              onboarding.verificationStatus === "approved",
          ),
          licenses: licenseSummary,
          history,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:assignmentId/caregiver-photo", async (request, response, next) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden(
        "Only the assigned client can view this caregiver photo.",
      ));
    }
    const { assignment } = await ownedAssignment(
      request.params.assignmentId,
      request.user,
    );
    const snapshot = await db
      .collection("caregiverOnboarding")
      .doc(assignment.caregiverId)
      .get();
    const metadata = snapshot.exists
      ? snapshot.data().profile?.photo
      : null;
    if (!metadata?.storagePath) {
      return next(notFound("The caregiver profile photo was not found."));
    }
    const file = await readPrivateFile(
      metadata.storagePath,
      metadata.storageProvider,
    );
    if (file.url) return response.redirect(file.url);
    response.set("Content-Type", metadata.type || "image/jpeg");
    response.set("Cache-Control", "private, max-age=300");
    return response.send(file.buffer);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:assignmentId/confirm", async (request, response, next) => {
  try {
    if (request.user.role !== "caregiver") {
      return next(forbidden("Only the assigned caregiver can confirm an assignment."));
    }
    const { reference, assignment } = await ownedAssignment(
      request.params.assignmentId,
      request.user,
    );
    if (assignment.status === "confirmed") {
      return response.json({ data: assignment });
    }
    if (assignment.status !== "pending_confirmation") {
      return next(conflict("This assignment cannot be confirmed."));
    }
    const visits = await db
      .collection("visits")
      .where("assignmentId", "==", assignment.assignmentId)
      .limit(100)
      .get();
    const now = new Date().toISOString();
    const update = {
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    };
    const batch = db.batch();
    batch.set(reference, update, { merge: true });
    visits.docs.forEach((document) => {
      batch.set(document.ref, {
        confirmationStatus: "confirmed",
        updatedAt: now,
      }, { merge: true });
    });
    const confirmedAssignment = { ...assignment, ...update };
    const advances = await queueCaregiverAcceptanceAdvance({
      db,
      batch,
      assignment: confirmedAssignment,
      now,
    });
    await batch.commit();
    return response.json({
      data: { ...confirmedAssignment, caregiverAdvances: advances },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:assignmentId", async (request, response, next) => {
  try {
    const { assignment } = await ownedAssignment(
      request.params.assignmentId,
      request.user,
    );
    const visits = await db
      .collection("visits")
      .where("assignmentId", "==", assignment.assignmentId)
      .limit(100)
      .get();
    return response.json({
      data: {
        ...assignment,
        visits: visits.docs
          .map((document) => document.data())
          .sort((a, b) => a.date.localeCompare(b.date)),
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
