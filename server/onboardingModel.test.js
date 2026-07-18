import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEditable,
  deriveOnboarding,
  emptyOnboarding,
  sanitizeAssessment,
  sanitizeProfile,
} from "./onboardingModel.js";

const completeRecord = () => {
  const record = emptyOnboarding({ uid: "caregiver-1", email: "caregiver@example.com" });
  record.profile = {
    ...record.profile,
    photo: { name: "photo.jpg", storagePath: "photo" },
    fullName: "Care Giver",
    dateOfBirth: "1990-01-01",
    gender: "Female",
    phone: "+8801000000000",
    address: "Dhaka",
    city: "Dhaka",
    state: "Dhaka",
    zipCode: "1212",
  };
  record.credentials = {
    ...record.credentials,
    resume: { name: "resume.pdf", storagePath: "resume" },
    nidFront: { name: "front.jpg", storagePath: "front" },
    nidBack: { name: "back.jpg", storagePath: "back" },
  };
  record.assessment = {
    emergency: "Call emergency services",
    ethics: "A sufficiently complete ethical response",
    hygiene: ["one", "two", "three", "four"],
  };
  return record;
};

test("derives completion and 90% review-ready progress", () => {
  const record = deriveOnboarding(completeRecord());
  assert.equal(record.profileCompleted, true);
  assert.equal(record.credentialsCompleted, true);
  assert.equal(record.progress, 90);
});

test("adds the final ten percent only after approval", () => {
  const record = deriveOnboarding({ ...completeRecord(), verificationStatus: "approved" });
  assert.equal(record.progress, 100);
});

test("locks an onboarding record during review", () => {
  assert.throws(() => assertEditable({ verificationStatus: "under_review" }), /locked/);
  assert.doesNotThrow(() => assertEditable({ verificationStatus: "changes_required" }));
});

test("sanitizers only keep supported fields", () => {
  const profile = sanitizeProfile({ fullName: "  Test User  ", isAdmin: true });
  const assessment = sanitizeAssessment({ hygiene: ["one", "one", "two"], injected: true });
  assert.equal(profile.fullName, "Test User");
  assert.equal("isAdmin" in profile, false);
  assert.deepEqual(assessment.hygiene, ["one", "two"]);
  assert.equal("injected" in assessment, false);
});
