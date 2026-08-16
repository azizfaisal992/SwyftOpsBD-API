import { randomUUID } from "node:crypto";
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
  deletePrivateFile,
  readPrivateFile,
  savePrivateFile,
} from "../services/fileStorage.js";

const router = Router();
const supportedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const categories = new Set([
  "prescription",
  "medical_report",
  "lab_result",
  "medication_schedule",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const safeFileName = (name) =>
  String(name || "medical-document")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);

router.use(authenticate, requireRole("client"));

const portalDocuments = async (clientId) => {
  const snapshot = await db
    .collection("clientMedicalDocuments")
    .where("clientId", "==", clientId)
    .limit(100)
    .get();
  return snapshot.docs.map((document) => ({
    ...document.data(),
    documentId: document.id,
    source: "medication_portal",
  }));
};

const onboardingDocuments = async (clientId) => {
  const snapshot = await db.collection("clientOnboarding").doc(clientId).get();
  if (!snapshot.exists) return [];
  const onboarding = snapshot.data();
  return (onboarding.documents?.medicalReports || []).map((document) => ({
    documentId: document.id,
    clientId,
    name: document.name,
    size: document.size,
    contentType: document.type,
    category: "medical_report",
    status:
      onboarding.verificationStatus === "approved" ? "reviewed" : "received",
    uploadedAt: document.uploadedAt,
    source: "onboarding",
  }));
};

router.get("/mine", async (request, response, next) => {
  try {
    const [portal, onboarding, instructionSnapshot] = await Promise.all([
      portalDocuments(request.user.uid),
      onboardingDocuments(request.user.uid),
      db.collection("clientMedicationInstructions").doc(request.user.uid).get(),
    ]);
    const documents = [...portal, ...onboarding].sort((left, right) =>
      String(right.uploadedAt || "").localeCompare(
        String(left.uploadedAt || ""),
      ),
    );
    return response.json({
      data: {
        documents,
        instructions: instructionSnapshot.exists
          ? instructionSnapshot.data().instructions || ""
          : "",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) return next(badRequest("Select a medical file."));
    if (!supportedTypes.has(request.file.mimetype)) {
      return next(new ApiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Upload a PDF, JPG, PNG or WebP medical document.",
      ));
    }
    const category = categories.has(request.body?.category)
      ? request.body.category
      : "prescription";
    const documentId = randomUUID();
    const uploadedAt = new Date().toISOString();
    const storagePath =
      `client-medical/${request.user.uid}/${documentId}/` +
      `${Date.now()}-${safeFileName(request.file.originalname)}`;
    const stored = await savePrivateFile({
      storagePath,
      buffer: request.file.buffer,
      contentType: request.file.mimetype,
      metadata: {
        ownerUid: request.user.uid,
        documentId,
        category,
      },
    });
    const record = {
      documentId,
      clientId: request.user.uid,
      name: request.file.originalname,
      size: request.file.size,
      contentType: request.file.mimetype,
      category,
      status: "pending_review",
      storagePath,
      storageProvider: stored.provider,
      uploadedAt,
      updatedAt: uploadedAt,
    };
    try {
      await db.collection("clientMedicalDocuments").doc(documentId).set(record);
    } catch (error) {
      await deletePrivateFile(storagePath, stored.provider);
      throw error;
    }
    return response.status(201).json({
      data: { ...record, source: "medication_portal" },
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/instructions", async (request, response, next) => {
  try {
    const instructions = String(request.body?.instructions || "").trim();
    if (instructions.length > 2000) {
      return next(validationError(
        "Medication instructions cannot exceed 2,000 characters.",
        { instructions: "Use 2,000 characters or fewer." },
      ));
    }
    const record = {
      clientId: request.user.uid,
      instructions,
      updatedAt: new Date().toISOString(),
    };
    await db
      .collection("clientMedicationInstructions")
      .doc(request.user.uid)
      .set(record, { merge: true });
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.get("/:documentId/download", async (request, response, next) => {
  try {
    let metadata;
    if (request.query.source === "onboarding") {
      const snapshot = await db
        .collection("clientOnboarding")
        .doc(request.user.uid)
        .get();
      metadata = snapshot.exists
        ? (snapshot.data().documents?.medicalReports || []).find(
            (document) => document.id === request.params.documentId,
          )
        : null;
    } else {
      const snapshot = await db
        .collection("clientMedicalDocuments")
        .doc(request.params.documentId)
        .get();
      metadata =
        snapshot.exists && snapshot.data().clientId === request.user.uid
          ? snapshot.data()
          : null;
    }
    if (!metadata?.storagePath) {
      return next(notFound("The medical document was not found."));
    }
    const file = await readPrivateFile(
      metadata.storagePath,
      metadata.storageProvider,
    );
    if (file.url) return response.redirect(file.url);
    response.set(
      "Content-Type",
      metadata.contentType || metadata.type || "application/octet-stream",
    );
    response.set(
      "Content-Disposition",
      `attachment; filename="${String(metadata.name || "medical-document")
        .replaceAll('"', "")}"`,
    );
    return response.send(file.buffer);
  } catch (error) {
    return next(error);
  }
});

export default router;
