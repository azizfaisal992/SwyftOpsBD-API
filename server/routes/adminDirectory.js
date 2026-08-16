import { Router } from "express";
import { createCarePlan } from "../careRequestModel.js";
import { deriveClientOnboarding } from "../clientOnboardingModel.js";
import { conflict, notFound, validationError } from "../errors/ApiError.js";
import { adminAuth, db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";
import { deriveOnboarding } from "../onboardingModel.js";
import {
  deletePrivateFile,
  readPrivateFile,
} from "../services/fileStorage.js";
import { createPayslipPdf } from "../services/payslipService.js";

const router = Router();
router.use(authenticate, requireAdmin);

const text = (value, maxLength = 200) =>
  String(value ?? "").trim().slice(0, maxLength);

const caregiverFiles = (record) => [
  ["profilePhoto", "Profile Photos", record.profile?.photo],
  ["resume", "Compliance", record.credentials?.resume],
  ["nidFront", "Caregiver IDs", record.credentials?.nidFront],
  ["nidBack", "Caregiver IDs", record.credentials?.nidBack],
  ["referenceLetter", "Compliance", record.credentials?.referenceLetter],
  ["licenseCRP", "Compliance", record.credentials?.licenses?.CRP],
  ["licenseAHLC", "Compliance", record.credentials?.licenses?.AHLC],
  ["licenseRNLC", "Compliance", record.credentials?.licenses?.RNLC],
];

const clientFiles = (record) => [
  ["nidFront", "Client IDs", record.documents?.nidFront],
  ["nidBack", "Client IDs", record.documents?.nidBack],
  ...(record.documents?.medicalReports || []).map((metadata) => [
    `medicalReport:${metadata.id}`,
    "Medical Documents",
    metadata,
  ]),
];

const documentType = (metadata = {}) => {
  const mime = String(metadata.type || metadata.contentType || "");
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.includes("word")) return "WORD";
  return "PDF";
};

const documentStatus = (verificationStatus) => ({
  approved: "Verified",
  rejected: "Rejected",
  changes_required: "Rejected",
  under_review: "Pending",
}[verificationStatus] || "Pending");

const toDocument = ({
  id,
  ownerId,
  owner,
  ownerRole,
  folder,
  metadata,
  status,
  source,
  kind,
}) => ({
  id,
  ownerId,
  owner,
  ownerRole,
  folder,
  name: metadata.name || "Uploaded document",
  type: documentType(metadata),
  contentType: metadata.type || metadata.contentType || "",
  size: Number(metadata.size || 0),
  uploadedAt: metadata.uploadedAt || metadata.updatedAt || "",
  status,
  sensitive: true,
  source,
  kind,
});

const sendPrivateDocument = async (response, metadata) => {
  if (!metadata?.storagePath) throw notFound("Document not found.");
  const file = await readPrivateFile(
    metadata.storagePath,
    metadata.storageProvider,
  );
  if (file.url) return response.redirect(file.url);
  response.set(
    "Content-Type",
    metadata.type || metadata.contentType || "application/octet-stream",
  );
  response.set(
    "Content-Disposition",
    `attachment; filename="${text(metadata.name || "document", 120).replaceAll('"', "")}"`,
  );
  return response.send(file.buffer);
};

router.patch("/caregivers/:caregiverId/status", async (request, response, next) => {
  try {
    const active = request.body?.active;
    if (typeof active !== "boolean") {
      return next(validationError("Select an active or suspended status.", {
        active: "Use true for active or false for suspended.",
      }));
    }
    const reference = db
      .collection("caregiverOnboarding")
      .doc(request.params.caregiverId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return next(notFound("Caregiver not found."));
    const now = new Date().toISOString();
    const accountStatus = active ? "active" : "suspended";
    await adminAuth.updateUser(request.params.caregiverId, {
      disabled: !active,
    });
    if (!active) {
      await adminAuth.revokeRefreshTokens(request.params.caregiverId);
    }
    const batch = db.batch();
    batch.set(reference, {
      accountStatus,
      ...(active
        ? {}
        : {
            directoryVisible: false,
            websitePublished: false,
            websiteFeatured: false,
          }),
      suspendedAt: active ? null : now,
      suspendedBy: active ? null : request.user.uid,
      updatedAt: now,
    }, { merge: true });
    batch.set(db.collection("users").doc(request.params.caregiverId), {
      accountStatus,
      ...(!active ? { directoryVisible: false } : {}),
      updatedAt: now,
    }, { merge: true });
    await batch.commit();
    return response.json({
      data: { caregiverId: request.params.caregiverId, active, accountStatus },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/caregivers/:caregiverId/directory",
  async (request, response, next) => {
    try {
      const visible = request.body?.visible;
      if (typeof visible !== "boolean") {
        return next(
          validationError("Select whether this caregiver is publicly visible.", {
            visible: "Use true to publish or false to hide.",
          }),
        );
      }
      const caregiverId = request.params.caregiverId;
      const reference = db.collection("caregiverOnboarding").doc(caregiverId);
      const snapshot = await reference.get();
      if (!snapshot.exists) return next(notFound("Caregiver not found."));
      const caregiver = snapshot.data();
      if (caregiver.verificationStatus !== "approved") {
        return next(
          conflict("Only an approved caregiver can be published."),
        );
      }
      if (caregiver.accountStatus === "suspended") {
        return next(
          conflict("Reactivate the caregiver account before publishing it."),
        );
      }
      const now = new Date().toISOString();
      const batch = db.batch();
      batch.set(
        reference,
        {
          directoryVisible: visible,
          websitePublished: visible,
          directoryUpdatedAt: now,
          directoryUpdatedBy: request.user.uid,
          updatedAt: now,
        },
        { merge: true },
      );
      batch.set(
        db.collection("users").doc(caregiverId),
        { directoryVisible: visible, updatedAt: now },
        { merge: true },
      );
      await batch.commit();
      return response.json({
        data: { caregiverId, directoryVisible: visible },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch("/caregivers/:caregiverId/profile", async (request, response, next) => {
  try {
    const reference = db
      .collection("caregiverOnboarding")
      .doc(request.params.caregiverId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return next(notFound("Caregiver not found."));
    const current = deriveOnboarding(snapshot.data());
    const profile = {
      ...current.profile,
      fullName: text(request.body?.fullName, 120) || current.profile.fullName,
      phone: text(request.body?.phone, 30),
      email: text(request.body?.email, 160),
      address: text(request.body?.address, 200),
      city: text(request.body?.city, 100),
      state: text(request.body?.state, 100),
      zipCode: text(request.body?.zipCode, 20),
      serviceRadius: Math.min(100, Math.max(
        1,
        Number(request.body?.serviceRadius) || current.profile.serviceRadius || 1,
      )),
      services: Array.isArray(request.body?.services)
        ? request.body.services
        : current.profile.services || [],
      hourlyRate:
        Number(request.body?.hourlyRate) > 0
          ? String(Math.round(Number(request.body.hourlyRate)))
          : current.profile.hourlyRate || "",
    };
    const record = deriveOnboarding({
      ...current,
      profile,
      updatedAt: new Date().toISOString(),
    });
    await reference.set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.patch("/clients/:clientId", async (request, response, next) => {
  try {
    const reference = db
      .collection("clientOnboarding")
      .doc(request.params.clientId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return next(notFound("Client not found."));
    const current = deriveClientOnboarding(snapshot.data());
    const record = deriveClientOnboarding({
      ...current,
      profile: {
        ...current.profile,
        fullName: text(request.body?.fullName, 120) || current.profile.fullName,
        dateOfBirth:
          text(request.body?.dateOfBirth, 20) || current.profile.dateOfBirth,
        gender: text(request.body?.gender, 40) || current.profile.gender,
        nidNumber: text(request.body?.nidNumber, 30) || current.profile.nidNumber,
      },
      contact: {
        ...current.contact,
        phone: text(request.body?.phone, 30) || current.contact.phone,
        email: text(request.body?.email, 160) || current.contact.email,
        area: text(request.body?.area, 120) || current.contact.area,
        road: text(request.body?.road, 160) || current.contact.road,
        house: text(request.body?.house, 160) || current.contact.house,
      },
      updatedAt: new Date().toISOString(),
    });
    await reference.set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.post("/clients/:clientId/renew-care", async (request, response, next) => {
  try {
    const clientSnapshot = await db
      .collection("clientOnboarding")
      .doc(request.params.clientId)
      .get();
    if (
      !clientSnapshot.exists ||
      clientSnapshot.data().verificationStatus !== "approved"
    ) {
      return next(conflict("Only an approved client can renew care."));
    }
    const plansSnapshot = await db.collection("carePlans")
      .where("clientId", "==", request.params.clientId)
      .limit(100)
      .get();
    const previous = plansSnapshot.docs
      .map((document) => document.data())
      .sort((a, b) =>
        String(b.updatedAt || b.createdAt)
          .localeCompare(String(a.updatedAt || a.createdAt)))[0];
    if (!previous) return next(notFound("No previous care plan was found."));
    const reference = db.collection("carePlans").doc();
    const data = {
      selectedCaregiverId: previous.selectedCaregiverId || "",
      selectedCaregiver: previous.selectedCaregiver || null,
      careType: previous.careType,
      tasks: previous.tasks || [],
      hoursPerWeek: previous.hoursPerWeek,
      preferredTime: previous.preferredTime,
      preferredStartTime: previous.preferredStartTime,
      serviceStartDate: new Date().toISOString().slice(0, 10),
      preferredDays: previous.preferredDays || [],
      caregiverGender: previous.caregiverGender,
      budgetRange: previous.budgetRange,
      transportation: previous.transportation || "",
    };
    const plan = {
      carePlanId: reference.id,
      ...createCarePlan({ clientId: request.params.clientId, data }),
      renewedFromCarePlanId: previous.carePlanId,
      renewedBy: request.user.uid,
    };
    await reference.set(plan);
    return response.status(201).json({ data: plan });
  } catch (error) {
    return next(error);
  }
});

const clientCollections = [
  ["carePlans", "clientId"],
  ["careRequests", "clientId"],
  ["assignments", "clientId"],
  ["visits", "clientId"],
  ["billingAgreements", "clientId"],
  ["invoices", "clientId"],
  ["transactions", "clientId"],
  ["paymentSessions", "clientId"],
  ["notifications", "userId"],
  ["incidents", "clientId"],
  ["clientMedicalDocuments", "clientId"],
];

router.delete("/clients/:clientId", async (request, response, next) => {
  try {
    if (String(request.body?.confirmClientId || "") !== request.params.clientId) {
      return next(validationError("Confirm the client ID before deletion.", {
        confirmClientId: "The confirmation must exactly match the client ID.",
      }));
    }
    const clientId = request.params.clientId;
    const onboardingReference = db.collection("clientOnboarding").doc(clientId);
    const onboardingSnapshot = await onboardingReference.get();
    if (!onboardingSnapshot.exists) return next(notFound("Client not found."));

    const fileMetadata = [
      ...clientFiles(onboardingSnapshot.data()).map((item) => item[2]),
    ];
    const snapshots = await Promise.all(clientCollections.map(
      ([collection, field]) =>
        db.collection(collection).where(field, "==", clientId).limit(500).get(),
    ));
    snapshots[clientCollections.findIndex(([name]) =>
      name === "clientMedicalDocuments")].docs.forEach((document) => {
      fileMetadata.push(document.data());
    });
    const conversations = await db.collection("conversations")
      .where("participantIds", "array-contains", clientId)
      .limit(200)
      .get();

    await Promise.all(fileMetadata
      .filter((metadata) => metadata?.storagePath)
      .map((metadata) =>
        deletePrivateFile(metadata.storagePath, metadata.storageProvider)));
    await Promise.all(conversations.docs.map((document) =>
      db.recursiveDelete(document.ref)));
    await Promise.all(snapshots.flatMap((snapshot) =>
      snapshot.docs.map((document) => document.ref.delete())));
    await Promise.all([
      onboardingReference.delete(),
      db.collection("clientMedicationInstructions").doc(clientId).delete(),
      db.collection("users").doc(clientId).delete(),
    ]);
    try {
      await adminAuth.deleteUser(clientId);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    return response.json({
      data: { clientId, deleted: true, deletedAt: new Date().toISOString() },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/documents", async (_request, response, next) => {
  try {
    const [
      caregivers,
      clients,
      medical,
      transactions,
      caregiverLedger,
      payouts,
    ] = await Promise.all([
      db.collection("caregiverOnboarding").limit(200).get(),
      db.collection("clientOnboarding").limit(200).get(),
      db.collection("clientMedicalDocuments").limit(500).get(),
      db.collection("transactions").limit(500).get(),
      db.collection("caregiverLedger").limit(500).get(),
      db.collection("payouts").limit(500).get(),
    ]);
    const records = [];
    const clientNames = new Map(
      clients.docs.map((document) => [
        document.id,
        document.data().profile?.fullName ||
          document.data().accountEmail ||
          "Client",
      ]),
    );
    const caregiverNames = new Map(
      caregivers.docs.map((document) => [
        document.id,
        document.data().profile?.fullName ||
          document.data().accountEmail ||
          "Caregiver",
      ]),
    );
    caregivers.docs.forEach((document) => {
      const record = document.data();
      caregiverFiles(record).forEach(([kind, folder, metadata]) => {
        if (!metadata?.storagePath) return;
        records.push(toDocument({
          id: `caregiver:${document.id}:${kind}`,
          ownerId: document.id,
          owner: record.profile?.fullName || record.accountEmail || "Caregiver",
          ownerRole: "caregiver",
          folder,
          metadata,
          status: documentStatus(record.verificationStatus),
          source: "caregiver",
          kind,
        }));
      });
    });
    clients.docs.forEach((document) => {
      const record = document.data();
      clientFiles(record).forEach(([kind, folder, metadata]) => {
        if (!metadata?.storagePath) return;
        records.push(toDocument({
          id: `client:${document.id}:${kind}`,
          ownerId: document.id,
          owner: record.profile?.fullName || record.accountEmail || "Client",
          ownerRole: "client",
          folder,
          metadata,
          status: documentStatus(record.verificationStatus),
          source: "client",
          kind,
        }));
      });
    });
    medical.docs.forEach((document) => {
      const metadata = document.data();
      records.push(toDocument({
        id: `medical:${document.id}`,
        ownerId: metadata.clientId,
        owner:
          metadata.clientName ||
          clientNames.get(metadata.clientId) ||
          "Client",
        ownerRole: "client",
        folder: "Medical Documents",
        metadata,
        status: metadata.status === "verified" ? "Verified" : "Pending",
        source: "medical",
        kind: document.id,
      }));
    });
    [
      ["transaction", transactions],
      ["earning", caregiverLedger],
      ["payout", payouts],
    ].forEach(([recordType, snapshot]) => {
      snapshot.docs.forEach((document) => {
        const record = document.data();
        const complete = ["successful", "completed", "paid"]
          .includes(record.status);
        if (!complete) return;
        const ownerId = recordType === "transaction"
          ? record.clientId
          : record.caregiverId;
        records.push({
          id: `payslip:${recordType}:${document.id}`,
          name: `${recordType}-${document.id}-payslip.pdf`,
          ownerId: ownerId || "",
          owner:
            record.clientName ||
            record.caregiverName ||
            (recordType === "transaction"
              ? clientNames.get(ownerId)
              : caregiverNames.get(ownerId)) ||
            "Account holder",
          ownerRole: recordType === "transaction" ? "client" : "caregiver",
          folder: "Financial Documents",
          type: "PDF",
          size: 0,
          uploadedAt:
            record.completedAt ||
            record.paidAt ||
            record.createdAt ||
            "",
          status: "Verified",
          sensitive: true,
        });
      });
    });
    records.sort((a, b) =>
      String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.get("/documents/:documentId/download", async (request, response, next) => {
  try {
    const [source, ownerId, ...kindParts] =
      decodeURIComponent(request.params.documentId).split(":");
    const kind = kindParts.join(":");
    if (source === "caregiver") {
      const snapshot = await db.collection("caregiverOnboarding").doc(ownerId).get();
      const entry = snapshot.exists
        ? caregiverFiles(snapshot.data()).find((item) => item[0] === kind)
        : null;
      return sendPrivateDocument(response, entry?.[2]);
    }
    if (source === "client") {
      const snapshot = await db.collection("clientOnboarding").doc(ownerId).get();
      const entry = snapshot.exists
        ? clientFiles(snapshot.data()).find((item) => item[0] === kind)
        : null;
      return sendPrivateDocument(response, entry?.[2]);
    }
    if (source === "medical") {
      const snapshot = await db.collection("clientMedicalDocuments").doc(ownerId).get();
      return sendPrivateDocument(response, snapshot.exists ? snapshot.data() : null);
    }
    if (source === "payslip") {
      const collections = {
        transaction: "transactions",
        earning: "caregiverLedger",
        payout: "payouts",
      };
      const collection = collections[ownerId];
      if (!collection || !kind) return next(notFound("Document not found."));
      const snapshot = await db.collection(collection).doc(kind).get();
      if (!snapshot.exists) return next(notFound("Document not found."));
      const record = snapshot.data();
      if (!["successful", "completed", "paid"].includes(record.status)) {
        return next(conflict("This payslip is not available yet."));
      }
      const { buffer, filename } = createPayslipPdf({
        record,
        recordType: ownerId,
        recipientName:
          record.clientName ||
          record.caregiverName ||
          "Account holder",
      });
      response.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
      });
      return response.send(buffer);
    }
    return next(notFound("Document not found."));
  } catch (error) {
    return next(error);
  }
});

export default router;
