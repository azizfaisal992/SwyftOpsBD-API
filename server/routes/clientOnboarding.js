import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import {
  assertClientOnboardingEditable,
  deriveClientOnboarding,
  getClientOnboardingRecord,
  sanitizeClientContact,
  sanitizeClientProfile,
} from "../clientOnboardingModel.js";
import {
  ApiError,
  badRequest,
  notFound,
  validationError,
} from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import {
  deletePrivateFile,
  savePrivateFile,
} from "../services/fileStorage.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const reportTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ...imageTypes,
];
const uploadKinds = {
  nidFront: { types: imageTypes },
  nidBack: { types: imageTypes },
  medicalReport: { types: reportTypes },
};

const safeFileName = (name) =>
  name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);

const validateProfile = (profile) => {
  const fields = {};
  if (!profile.fullName) fields.fullName = "Full name is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth)) {
    fields.dateOfBirth = "Enter a valid date of birth.";
  }
  if (!profile.gender) fields.gender = "Gender is required.";
  if (!/^(\d{10}|\d{17})$/.test(profile.nidNumber)) {
    fields.nidNumber = "NID must contain exactly 10 or 17 digits.";
  }
  if (Object.keys(fields).length) {
    throw validationError("Correct the client profile fields.", fields);
  }
};

const validateContact = (contact) => {
  const fields = {};
  if (!/^[0-9+()\-\s]{7,20}$/.test(contact.phone)) {
    fields.phone = "Enter a valid phone number.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    fields.email = "Enter a valid email address.";
  }
  for (const field of ["area", "road", "house"]) {
    if (!contact[field]) fields[field] = "This address field is required.";
  }
  if (!contact.locationPinned) {
    fields.locationPinned = "Pin the service location before continuing.";
  }
  if (
    !Number.isFinite(contact.latitude) ||
    contact.latitude < 20.5 ||
    contact.latitude > 26.8
  ) {
    fields.latitude = "Select a service location inside Bangladesh.";
  }
  if (
    !Number.isFinite(contact.longitude) ||
    contact.longitude < 88 ||
    contact.longitude > 92.8
  ) {
    fields.longitude = "Select a service location inside Bangladesh.";
  }
  if (Object.keys(fields).length) {
    throw validationError("Correct the client contact fields.", fields);
  }
};

const fileMetadata = (request, storagePath, storageProvider, id) => ({
  id,
  name: request.file.originalname,
  size: request.file.size,
  type: request.file.mimetype,
  storagePath,
  storageProvider,
  uploadedAt: new Date().toISOString(),
});

router.use(authenticate, requireRole("client"));

router.get("/me", async (request, response, next) => {
  try {
    return response.json({
      data: await getClientOnboardingRecord(db, request.user),
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/profile", async (request, response, next) => {
  try {
    const current = await getClientOnboardingRecord(db, request.user);
    assertClientOnboardingEditable(current);
    const profile = sanitizeClientProfile(request.body);
    validateProfile(profile);
    const record = deriveClientOnboarding({ ...current, profile });
    await db.collection("clientOnboarding").doc(request.user.uid).set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.put("/contact", async (request, response, next) => {
  try {
    const current = await getClientOnboardingRecord(db, request.user);
    assertClientOnboardingEditable(current);
    const contact = sanitizeClientContact(request.body);
    validateContact(contact);
    const record = deriveClientOnboarding({ ...current, contact });
    await db.collection("clientOnboarding").doc(request.user.uid).set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.post("/files/:kind", upload.single("file"), async (request, response, next) => {
  try {
    const configuration = uploadKinds[request.params.kind];
    if (!configuration) return next(notFound("Unknown client document type."));
    if (!request.file) return next(badRequest("Select a file to upload."));
    if (!configuration.types.includes(request.file.mimetype)) {
      return next(new ApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "This client document format is not supported.",
      ));
    }

    const current = await getClientOnboardingRecord(db, request.user);
    assertClientOnboardingEditable(current);
    if (
      request.params.kind === "medicalReport" &&
      current.documents.medicalReports.length >= 10
    ) {
      return next(badRequest(
        "A maximum of 10 medical reports can be attached.",
      ));
    }
    const fileId = randomUUID();
    const storagePath =
      `client-onboarding/${request.user.uid}/${request.params.kind}/` +
      `${Date.now()}-${safeFileName(request.file.originalname)}`;
    const storedFile = await savePrivateFile({
      storagePath,
      buffer: request.file.buffer,
      contentType: request.file.mimetype,
      metadata: {
        ownerUid: request.user.uid,
        onboardingKind: request.params.kind,
        fileId,
      },
    });
    const metadata = fileMetadata(
      request,
      storagePath,
      storedFile.provider,
      fileId,
    );

    let previousFile = null;
    let documents;
    if (request.params.kind === "medicalReport") {
      documents = {
        ...current.documents,
        medicalReports: [...current.documents.medicalReports, metadata],
      };
    } else {
      previousFile = current.documents[request.params.kind];
      documents = {
        ...current.documents,
        [request.params.kind]: metadata,
      };
    }

    const record = deriveClientOnboarding({ ...current, documents });
    try {
      await db.collection("clientOnboarding").doc(request.user.uid).set(record);
    } catch (error) {
      await deletePrivateFile(storagePath, storedFile.provider);
      throw error;
    }
    if (previousFile?.storagePath) {
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

router.delete("/files/medicalReport/:fileId", async (request, response, next) => {
  try {
    const current = await getClientOnboardingRecord(db, request.user);
    assertClientOnboardingEditable(current);
    const existing = current.documents.medicalReports.find(
      (file) => file.id === request.params.fileId,
    );
    if (!existing) return next(notFound("Medical report not found."));
    await deletePrivateFile(existing.storagePath, existing.storageProvider);
    const record = deriveClientOnboarding({
      ...current,
      documents: {
        ...current.documents,
        medicalReports: current.documents.medicalReports.filter(
          (file) => file.id !== request.params.fileId,
        ),
      },
    });
    await db.collection("clientOnboarding").doc(request.user.uid).set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.delete("/files/:kind", async (request, response, next) => {
  try {
    if (!["nidFront", "nidBack"].includes(request.params.kind)) {
      return next(notFound("Unknown client document type."));
    }
    const current = await getClientOnboardingRecord(db, request.user);
    assertClientOnboardingEditable(current);
    const existing = current.documents[request.params.kind];
    if (existing?.storagePath) {
      await deletePrivateFile(existing.storagePath, existing.storageProvider);
    }
    const record = deriveClientOnboarding({
      ...current,
      documents: {
        ...current.documents,
        [request.params.kind]: null,
      },
    });
    await db.collection("clientOnboarding").doc(request.user.uid).set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.post("/submit", async (request, response, next) => {
  try {
    const current = await getClientOnboardingRecord(db, request.user);
    assertClientOnboardingEditable(current);
    if (
      !current.profileCompleted ||
      !current.contactCompleted ||
      !current.documentsCompleted
    ) {
      return next(validationError(
        "Complete the profile, contact location and both NID documents before submitting.",
      ));
    }
    if (request.body?.confirmed !== true) {
      return next(validationError(
        "Confirm that the client information and documents are correct.",
        { confirmed: "Confirmation is required." },
      ));
    }

    const record = deriveClientOnboarding({
      ...current,
      confirmed: true,
      submitted: true,
      verificationStatus: "under_review",
      submittedAt: new Date().toISOString(),
      reviewFeedback: "",
    });
    await db.collection("clientOnboarding").doc(request.user.uid).set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

export default router;
