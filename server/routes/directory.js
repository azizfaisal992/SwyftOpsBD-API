import { Router } from "express";
import { notFound } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { readPrivateFile } from "../services/fileStorage.js";

const router = Router();

const yearsOld = (dateOfBirth) => {
  const start = new Date(dateOfBirth);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000)),
  );
};

const publicCaregiver = (record) => {
  const profile = record.profile || {};
  const directory = record.directoryProfile || {};
  const statistics = record.directoryStats || {};
  const certifications = [
    record.credentials?.licenses?.CRP ? "CRP License Verified" : "",
    record.credentials?.licenses?.AHLC ? "AHLC License Verified" : "",
    record.credentials?.licenses?.RNLC ? "RNLC License Verified" : "",
    record.credentials?.resume ? "Professional Resume Verified" : "",
  ].filter(Boolean);
  return {
    id: record.caregiverId,
    name: profile.fullName || "SwiftOpsBD Caregiver",
    role: directory.role || "Verified Professional Caregiver",
    location: profile.city || profile.state || "Dhaka",
    postalCode: String(profile.zipCode || directory.zipCode || ""),
    distance: "Service area available",
    rate: Math.max(
      0,
      Number(profile.hourlyRate || directory.hourlyRate || 0),
    ),
    rating: Math.max(0, Number(statistics.averageRating || 0)),
    reviews: Math.max(0, Number(statistics.reviewCount || 0)),
    gender: profile.gender || "",
    experienceYears: Math.max(0, Number(directory.experienceYears || 0)),
    experience: directory.experienceYears
      ? `${directory.experienceYears} Years Experience`
      : "Verified Professional",
    tags:
      Array.isArray(profile.services) && profile.services.length
        ? profile.services.slice(0, 8)
        : Array.isArray(directory.services) && directory.services.length
          ? directory.services.slice(0, 8)
        : ["Home Care"],
    certifications: certifications.length
      ? certifications
      : ["Identity & Background Verified"],
    biography:
      directory.biography ||
      "An approved SwiftOpsBD caregiver available to support families in Dhaka.",
    age: yearsOld(profile.dateOfBirth),
    hasPhoto: Boolean(profile.photo?.storagePath),
  };
};

router.get("/caregivers", async (_request, response, next) => {
  try {
    const snapshot = await db
      .collection("caregiverOnboarding")
      .where("verificationStatus", "==", "approved")
      .limit(200)
      .get();
    const caregivers = snapshot.docs
      .map((document) => document.data())
      .filter(
        (record) =>
          record.accountStatus !== "suspended" &&
          record.directoryVisible === true,
      )
      .map(publicCaregiver)
      .sort((left, right) => right.rating - left.rating);
    return response.json({ data: caregivers });
  } catch (error) {
    return next(error);
  }
});

router.get("/caregivers/:caregiverId/photo", async (request, response, next) => {
  try {
    const snapshot = await db
      .collection("caregiverOnboarding")
      .doc(request.params.caregiverId)
      .get();
    if (!snapshot.exists) return next(notFound("Caregiver not found."));
    const caregiver = snapshot.data();
    if (
      caregiver.verificationStatus !== "approved" ||
      caregiver.accountStatus === "suspended" ||
      caregiver.directoryVisible !== true ||
      !caregiver.profile?.photo?.storagePath
    ) {
      return next(notFound("Caregiver photo not found."));
    }
    const metadata = caregiver.profile.photo;
    const file = await readPrivateFile(
      metadata.storagePath,
      metadata.storageProvider,
    );
    response.set("Cache-Control", "public, max-age=300");
    if (file.url) return response.redirect(file.url);
    response.set(
      "Content-Type",
      metadata.type || metadata.contentType || "image/jpeg",
    );
    return response.send(file.buffer);
  } catch (error) {
    return next(error);
  }
});

export default router;
