import { Router } from "express";
import multer from "multer";
import { db } from "../firebaseAdmin.js";
import {
  ApiError,
  badRequest,
  notFound,
  validationError,
} from "../errors/ApiError.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import {
  assertEditable,
  deriveOnboarding,
  getOnboardingRecord,
  sanitizeAssessment,
  sanitizeProfile,
} from "../onboardingModel.js";
import {
  deletePrivateFile,
  savePrivateFile,
} from "../services/fileStorage.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const uploadKinds = {
  profilePhoto: { target: ["profile", "photo"], types: ["image/jpeg", "image/png", "image/webp"] },
  resume: { target: ["credentials", "resume"], types: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  nidFront: { target: ["credentials", "nidFront"], types: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  nidBack: { target: ["credentials", "nidBack"], types: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  referenceLetter: { target: ["credentials", "referenceLetter"], types: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  licenseCRP: { target: ["credentials", "licenses", "CRP"], types: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  licenseAHLC: { target: ["credentials", "licenses", "AHLC"], types: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  licenseRNLC: { target: ["credentials", "licenses", "RNLC"], types: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
};

const safeFileName = (name) =>
  name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(-120);

const setNestedValue = (record, path, value) => {
  const nextRecord = structuredClone(record);
  let target = nextRecord;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path.at(-1)] = value;
  return nextRecord;
};

router.use(authenticate, requireRole("caregiver"));

router.get("/me", async (request, response, next) => {
  try {
    response.json({ data: await getOnboardingRecord(db, request.user) });
  } catch (error) {
    next(error);
  }
});

router.put("/profile", async (request, response, next) => {
  try {
    const current = await getOnboardingRecord(db, request.user);
    assertEditable(current);
    const record = deriveOnboarding({
      ...current,
      profile: { ...current.profile, ...sanitizeProfile(request.body) },
    });
    await db.collection("caregiverOnboarding").doc(request.user.uid).set(record);
    response.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.put("/assessment", async (request, response, next) => {
  try {
    const current = await getOnboardingRecord(db, request.user);
    assertEditable(current);
    const record = deriveOnboarding({
      ...current,
      assessment: sanitizeAssessment(request.body),
    });
    await db.collection("caregiverOnboarding").doc(request.user.uid).set(record);
    response.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.post("/files/:kind", upload.single("file"), async (request, response, next) => {
  try {
    const configuration = uploadKinds[request.params.kind];
    if (!configuration) return next(notFound("Unknown onboarding file type."));
    if (!request.file) return next(badRequest("Select a file to upload."));
    if (!configuration.types.includes(request.file.mimetype)) {
      return next(new ApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "This file format is not supported.",
      ));
    }

    const current = await getOnboardingRecord(db, request.user);
    assertEditable(current);
    let previousFile = current;
    for (const key of configuration.target) previousFile = previousFile?.[key];
    const storagePath = `caregiver-onboarding/${request.user.uid}/${request.params.kind}/${Date.now()}-${safeFileName(request.file.originalname)}`;
    const storedFile = await savePrivateFile({
      storagePath,
      buffer: request.file.buffer,
      contentType: request.file.mimetype,
      metadata: {
        ownerUid: request.user.uid,
        onboardingKind: request.params.kind,
      },
    });

    const metadata = {
      name: request.file.originalname,
      size: request.file.size,
      type: request.file.mimetype,
      storagePath,
      storageProvider: storedFile.provider,
      uploadedAt: new Date().toISOString(),
    };
    const record = deriveOnboarding(setNestedValue(current, configuration.target, metadata));
    await db.collection("caregiverOnboarding").doc(request.user.uid).set(record);
    if (previousFile?.storagePath && previousFile.storagePath !== storagePath) {
      await deletePrivateFile(
        previousFile.storagePath,
        previousFile.storageProvider,
      );
    }
    return response.status(201).json({ data: record, file: metadata });
  } catch (error) {
    return next(error);
  }
});

router.delete("/files/:kind", async (request, response, next) => {
  try {
    const configuration = uploadKinds[request.params.kind];
    if (!configuration) return next(notFound("Unknown onboarding file type."));

    const current = await getOnboardingRecord(db, request.user);
    assertEditable(current);
    let existing = current;
    for (const key of configuration.target) existing = existing?.[key];
    if (existing?.storagePath) {
      await deletePrivateFile(existing.storagePath, existing.storageProvider);
    }

    const record = deriveOnboarding(setNestedValue(current, configuration.target, null));
    await db.collection("caregiverOnboarding").doc(request.user.uid).set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.post("/submit", async (request, response, next) => {
  try {
    const current = await getOnboardingRecord(db, request.user);
    assertEditable(current);
    const ethicsWordCount = current.assessment.ethics.split(/\s+/).filter(Boolean).length;

    if (!current.profileCompleted || !current.credentialsCompleted) {
      return next(validationError(
        "Complete the profile and required credentials before submitting.",
      ));
    }
    if (!current.assessment.emergency || ethicsWordCount < 50 || current.assessment.hygiene.length < 4) {
      return next(validationError(
        "Complete every required assessment question before submitting.",
      ));
    }

    const record = deriveOnboarding({
      ...current,
      assessmentSubmitted: true,
      verificationStatus: "under_review",
      submittedAt: new Date().toISOString(),
      reviewFeedback: "",
    });
    await db.collection("caregiverOnboarding").doc(request.user.uid).set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

export default router;
