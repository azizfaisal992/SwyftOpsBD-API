import { Router } from "express";
import { deriveClientOnboarding } from "../clientOnboardingModel.js";
import { db } from "../firebaseAdmin.js";
import { conflict, notFound, validationError } from "../errors/ApiError.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";
import { deriveOnboarding } from "../onboardingModel.js";
import { readPrivateFile } from "../services/fileStorage.js";

const router = Router();
router.use(authenticate, requireAdmin);

const filePaths = {
  profilePhoto: ["profile", "photo"],
  resume: ["credentials", "resume"],
  nidFront: ["credentials", "nidFront"],
  nidBack: ["credentials", "nidBack"],
  referenceLetter: ["credentials", "referenceLetter"],
  licenseCRP: ["credentials", "licenses", "CRP"],
  licenseAHLC: ["credentials", "licenses", "AHLC"],
  licenseRNLC: ["credentials", "licenses", "RNLC"],
};

const clientFileMetadata = (record, kind, fileId) => {
  if (kind === "nidFront" || kind === "nidBack") {
    return record.documents?.[kind];
  }
  if (kind === "medicalReport" && fileId) {
    return record.documents?.medicalReports?.find((file) => file.id === fileId);
  }
  return null;
};

router.get("/onboarding", async (request, response, next) => {
  try {
    const status = String(request.query.status || "under_review");
    const snapshot = await db.collection("caregiverOnboarding").where("verificationStatus", "==", status).limit(100).get();
    return response.json({ data: snapshot.docs.map((document) => document.data()) });
  } catch (error) {
    return next(error);
  }
});

router.patch("/onboarding/:caregiverId/review", async (request, response, next) => {
  try {
    const decision = String(request.body.decision || "");
    if (!["approved", "changes_required", "rejected"].includes(decision)) {
      return next(validationError("Decision must be approved, changes_required or rejected.", {
        decision: "Use approved, changes_required or rejected.",
      }));
    }

    const reference = db.collection("caregiverOnboarding").doc(request.params.caregiverId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return next(notFound("Caregiver onboarding record not found."));
    const current = deriveOnboarding(snapshot.data());
    const isApprovedRevocation =
      current.verificationStatus === "approved" && decision === "rejected";
    if (
      current.verificationStatus !== "under_review" &&
      !isApprovedRevocation
    ) {
      return next(conflict(
        "Only a submitted record can be reviewed, or an approved verification can be rejected.",
      ));
    }
    if (
      decision === "approved" &&
      (!current.profileCompleted ||
        !current.credentialsCompleted ||
        !current.assessmentSubmitted)
    ) {
      return next(validationError(
        "This caregiver submission is incomplete and cannot be approved.",
      ));
    }
    const feedback = String(request.body.feedback || "").trim();
    if (decision !== "approved" && !feedback) {
      return next(validationError(
        "Feedback is required when requesting changes or rejecting a submission.",
        { feedback: "Explain the review decision." },
      ));
    }

    const record = deriveOnboarding({
      ...current,
      verificationStatus: decision,
      reviewFeedback: feedback,
      reviewedAt: new Date().toISOString(),
      reviewedBy: request.user.uid,
      assessmentSubmitted: decision !== "changes_required",
    });
    const batch = db.batch();
    batch.set(reference, record);
    batch.set(
      db.collection("users").doc(request.params.caregiverId),
      {
        verificationStatus: decision,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    await batch.commit();
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.get("/onboarding/:caregiverId/files/:kind/url", async (request, response, next) => {
  try {
    const path = filePaths[request.params.kind];
    if (!path) return next(notFound("Unknown onboarding file type."));
    const snapshot = await db.collection("caregiverOnboarding").doc(request.params.caregiverId).get();
    if (!snapshot.exists) return next(notFound("Caregiver onboarding record not found."));

    let metadata = snapshot.data();
    for (const key of path) metadata = metadata?.[key];
    if (!metadata?.storagePath) return next(notFound("This file has not been uploaded."));

    const file = await readPrivateFile(
      metadata.storagePath,
      metadata.storageProvider,
    );
    if (file.url) {
      return response.json({
        data: {
          url: file.url,
          expiresInSeconds: file.expiresInSeconds || 900,
        },
      });
    }

    const url = `/api/v1/admin/onboarding/${encodeURIComponent(request.params.caregiverId)}/files/${encodeURIComponent(request.params.kind)}/download`;
    return response.json({ data: { url, requiresAuthorization: true } });
  } catch (error) {
    return next(error);
  }
});

router.get("/client-onboarding", async (request, response, next) => {
  try {
    const status = String(request.query.status || "under_review");
    const snapshot = await db
      .collection("clientOnboarding")
      .where("verificationStatus", "==", status)
      .limit(100)
      .get();
    return response.json({
      data: snapshot.docs.map((document) =>
        deriveClientOnboarding(document.data())),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/client-onboarding/:clientId/review", async (request, response, next) => {
  try {
    const decision = String(request.body.decision || "");
    if (!["approved", "changes_required", "rejected"].includes(decision)) {
      return next(validationError(
        "Decision must be approved, changes_required or rejected.",
        { decision: "Use approved, changes_required or rejected." },
      ));
    }

    const reference = db
      .collection("clientOnboarding")
      .doc(request.params.clientId);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      return next(notFound("Client onboarding record not found."));
    }
    const current = deriveClientOnboarding(snapshot.data());
    const isApprovedRevocation =
      current.verificationStatus === "approved" && decision === "rejected";
    if (
      current.verificationStatus !== "under_review" &&
      !isApprovedRevocation
    ) {
      return next(conflict(
        "Only a submitted record can be reviewed, or an approved verification can be rejected.",
      ));
    }
    if (
      decision === "approved" &&
      (!current.submitted ||
        !current.profileCompleted ||
        !current.contactCompleted ||
        !current.documentsCompleted)
    ) {
      return next(validationError(
        "This client submission is incomplete and cannot be approved.",
      ));
    }
    const feedback = String(request.body.feedback || "").trim();
    if (decision !== "approved" && !feedback) {
      return next(validationError(
        "Feedback is required when requesting changes or rejecting a submission.",
        { feedback: "Explain the review decision." },
      ));
    }

    const record = deriveClientOnboarding({
      ...current,
      verificationStatus: decision,
      reviewFeedback: feedback,
      reviewedAt: new Date().toISOString(),
      reviewedBy: request.user.uid,
      submitted: decision !== "changes_required",
    });
    const batch = db.batch();
    batch.set(reference, record);
    batch.set(
      db.collection("users").doc(request.params.clientId),
      {
        verificationStatus: decision,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    await batch.commit();
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.get("/client-onboarding/:clientId/files/:kind/url", async (request, response, next) => {
  try {
    const snapshot = await db
      .collection("clientOnboarding")
      .doc(request.params.clientId)
      .get();
    if (!snapshot.exists) {
      return next(notFound("Client onboarding record not found."));
    }
    const metadata = clientFileMetadata(
      snapshot.data(),
      request.params.kind,
      String(request.query.fileId || ""),
    );
    if (!metadata?.storagePath) {
      return next(notFound("This client document has not been uploaded."));
    }

    const file = await readPrivateFile(
      metadata.storagePath,
      metadata.storageProvider,
    );
    if (file.url) {
      return response.json({
        data: {
          url: file.url,
          expiresInSeconds: file.expiresInSeconds || 900,
        },
      });
    }

    const query = metadata.id
      ? `?fileId=${encodeURIComponent(metadata.id)}`
      : "";
    const url =
      `/api/v1/admin/client-onboarding/` +
      `${encodeURIComponent(request.params.clientId)}/files/` +
      `${encodeURIComponent(request.params.kind)}/download${query}`;
    return response.json({
      data: { url, requiresAuthorization: true },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/client-onboarding/:clientId/files/:kind/download", async (request, response, next) => {
  try {
    const snapshot = await db
      .collection("clientOnboarding")
      .doc(request.params.clientId)
      .get();
    if (!snapshot.exists) {
      return next(notFound("Client onboarding record not found."));
    }
    const metadata = clientFileMetadata(
      snapshot.data(),
      request.params.kind,
      String(request.query.fileId || ""),
    );
    if (!metadata?.storagePath) {
      return next(notFound("This client document has not been uploaded."));
    }

    const file = await readPrivateFile(
      metadata.storagePath,
      metadata.storageProvider,
    );
    if (file.url) return response.redirect(file.url);

    response.set("Content-Type", metadata.type || "application/octet-stream");
    response.set(
      "Content-Disposition",
      `inline; filename="${String(metadata.name || "document").replaceAll('"', "")}"`,
    );
    return response.send(file.buffer);
  } catch (error) {
    return next(error);
  }
});

router.get("/onboarding/:caregiverId/files/:kind/download", async (request, response, next) => {
  try {
    const path = filePaths[request.params.kind];
    if (!path) return next(notFound("Unknown onboarding file type."));
    const snapshot = await db.collection("caregiverOnboarding").doc(request.params.caregiverId).get();
    if (!snapshot.exists) return next(notFound("Caregiver onboarding record not found."));

    let metadata = snapshot.data();
    for (const key of path) metadata = metadata?.[key];
    if (!metadata?.storagePath) return next(notFound("This file has not been uploaded."));

    const file = await readPrivateFile(
      metadata.storagePath,
      metadata.storageProvider,
    );
    if (file.url) return response.redirect(file.url);

    response.set("Content-Type", metadata.type || "application/octet-stream");
    response.set(
      "Content-Disposition",
      `inline; filename="${String(metadata.name || "document").replaceAll('"', "")}"`,
    );
    return response.send(file.buffer);
  } catch (error) {
    return next(error);
  }
});

export default router;
