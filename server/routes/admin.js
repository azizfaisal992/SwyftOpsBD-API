import { Router } from "express";
import { bucket, db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";
import { deriveOnboarding } from "../onboardingModel.js";

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
    if (!["approved", "changes_required"].includes(decision)) {
      return response.status(422).json({ error: "Decision must be approved or changes_required." });
    }

    const reference = db.collection("caregiverOnboarding").doc(request.params.caregiverId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return response.status(404).json({ error: "Caregiver onboarding record not found." });

    const record = deriveOnboarding({
      ...snapshot.data(),
      verificationStatus: decision,
      reviewFeedback: String(request.body.feedback || "").trim(),
      reviewedAt: new Date().toISOString(),
      reviewedBy: request.user.uid,
      assessmentSubmitted: decision === "approved",
    });
    await reference.set(record);
    return response.json({ data: record });
  } catch (error) {
    return next(error);
  }
});

router.get("/onboarding/:caregiverId/files/:kind/url", async (request, response, next) => {
  try {
    const path = filePaths[request.params.kind];
    if (!path) return response.status(404).json({ error: "Unknown onboarding file type." });
    const snapshot = await db.collection("caregiverOnboarding").doc(request.params.caregiverId).get();
    if (!snapshot.exists) return response.status(404).json({ error: "Caregiver onboarding record not found." });

    let metadata = snapshot.data();
    for (const key of path) metadata = metadata?.[key];
    if (!metadata?.storagePath) return response.status(404).json({ error: "This file has not been uploaded." });

    const [url] = await bucket.file(metadata.storagePath).getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });
    return response.json({ data: { url, expiresInSeconds: 900 } });
  } catch (error) {
    return next(error);
  }
});

export default router;
