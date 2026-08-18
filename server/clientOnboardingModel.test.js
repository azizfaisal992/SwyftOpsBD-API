import assert from "node:assert/strict";
import test from "node:test";
import {
  assertClientOnboardingEditable,
  deriveClientOnboarding,
  emptyClientOnboarding,
  sanitizeClientContact,
  sanitizeClientProfile,
} from "./clientOnboardingModel.js";

const completeRecord = () => {
  const record = emptyClientOnboarding({
    uid: "client-1",
    email: "client@example.com",
  });
  record.profile = {
    fullName: "Test Client",
    dateOfBirth: "1990-01-01",
    gender: "Female",
    nidNumber: "1234567890",
  };
  record.contact = {
    phone: "1712345678",
    email: "client@example.com",
    area: "Dhanmondi",
    road: "Road 10",
    house: "House 23",
    locationPinned: true,
    latitude: 23.7465,
    longitude: 90.376,
  };
  record.documents = {
    nidFront: { name: "front.jpg", storagePath: "front" },
    nidBack: { name: "back.jpg", storagePath: "back" },
    medicalReports: [],
  };
  return record;
};

test("derives a review-ready client record at ninety percent", () => {
  const record = deriveClientOnboarding(completeRecord());
  assert.equal(record.profileCompleted, true);
  assert.equal(record.contactCompleted, true);
  assert.equal(record.documentsCompleted, true);
  assert.equal(record.progress, 90);
});

test("adds the final ten percent after client approval", () => {
  const record = deriveClientOnboarding({
    ...completeRecord(),
    verificationStatus: "approved",
  });
  assert.equal(record.progress, 100);
});

test("requires a pinned client location", () => {
  const source = completeRecord();
  source.contact.locationPinned = false;
  const record = deriveClientOnboarding(source);
  assert.equal(record.contactCompleted, false);
  assert.ok(record.progress < 90);
});

test("locks submitted client records while under review", () => {
  assert.throws(
    () => assertClientOnboardingEditable({
      verificationStatus: "under_review",
    }),
    /locked/,
  );
  assert.throws(
    () => assertClientOnboardingEditable({
      verificationStatus: "rejected",
    }),
    /locked/,
  );
  assert.doesNotThrow(() => assertClientOnboardingEditable({
    verificationStatus: "changes_required",
  }));
});

test("client sanitizers retain only supported fields", () => {
  const profile = sanitizeClientProfile({
    fullName: "  Test Client  ",
    nidNumber: "123 456 7890",
    role: "admin",
  });
  const contact = sanitizeClientContact({
    email: " CLIENT@EXAMPLE.COM ",
    locationPinned: true,
    latitude: "23.7465",
    longitude: "90.376",
    trustScore: 100,
  });
  assert.equal(profile.fullName, "Test Client");
  assert.equal(profile.nidNumber, "1234567890");
  assert.equal("role" in profile, false);
  assert.equal(contact.email, "client@example.com");
  assert.equal(contact.locationPinned, true);
  assert.equal(contact.latitude, 23.7465);
  assert.equal(contact.longitude, 90.376);
  assert.equal("trustScore" in contact, false);
});
