import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCareRequest,
  calculateAge,
  createCarePlan,
  isCareRequestVisibleToCaregiver,
  sanitizeCarePlan,
  validateCarePlan,
} from "./careRequestModel.js";

const validInput = {
  selectedCaregiverId: "caregiver-1",
  selectedCaregiver: {
    name: "Kelly S.",
    role: "Registered Nurse",
    rate: 850,
    image: "https://example.test/kelly.jpg",
  },
  careType: "Senior Care",
  tasks: ["Medication Reminders", "Mobility Assistance"],
  hoursPerWeek: 20,
  preferredTime: "Mornings",
  preferredStartTime: "09:30",
  serviceStartDate: "2026-08-03",
  serviceEndDate: "2026-08-30",
  preferredDays: ["Mon", "Wed", "Fri"],
  caregiverGender: "No Preference",
  budgetRange: "BDT 15,000 - 25,000",
  transportation: "Accompany the client to appointments.",
};

test("sanitizes and validates a complete care plan", () => {
  const plan = sanitizeCarePlan(validInput);
  assert.deepEqual(validateCarePlan(plan), {});
  assert.equal(plan.hoursPerWeek, 20);
  assert.equal(plan.preferredStartTime, "09:30");
  assert.equal(plan.serviceStartDate, "2026-08-03");
  assert.equal(plan.serviceEndDate, "2026-08-30");
  assert.deepEqual(plan.preferredDays, ["Mon", "Wed", "Fri"]);
});

test("rejects incomplete care plan fields", () => {
  const fields = validateCarePlan(sanitizeCarePlan({}));
  assert.ok(fields.careType);
  assert.ok(fields.tasks);
  assert.ok(fields.hoursPerWeek);
  assert.ok(fields.preferredDays);
  assert.ok(fields.preferredStartTime);
  assert.ok(fields.serviceStartDate);
  assert.ok(fields.serviceEndDate);
});

test("creates a draft plan and a private client request snapshot", () => {
  const data = sanitizeCarePlan(validInput);
  const plan = createCarePlan({
    clientId: "client-1",
    data,
    now: "2026-07-26T00:00:00.000Z",
  });
  const request = buildCareRequest({
    id: "plan-1",
    plan,
    client: {
      profile: {
        fullName: "Abdul Karim",
        dateOfBirth: "1952-05-15",
        gender: "Male",
      },
      contact: {
        phone: "+8801711000000",
        email: "client@example.com",
        area: "Dhanmondi",
        road: "Road 10",
        house: "House 23",
        locationPinned: true,
      },
      verificationStatus: "approved",
    },
    now: "2026-07-26T00:00:00.000Z",
  });

  assert.equal(plan.status, "draft");
  assert.equal(request.status, "open");
  assert.equal(request.paymentStatus, "pending");
  assert.equal(request.client.verified, true);
  assert.equal(request.client.fullName, "Abdul Karim");
  assert.equal(request.preferredStartTime, "09:30");
  assert.equal(request.serviceStartDate, "2026-08-03");
  assert.equal(request.serviceEndDate, "2026-08-30");
});

test("limits a specifically requested care request to that caregiver", () => {
  assert.equal(isCareRequestVisibleToCaregiver({
    status: "open",
    requestedCaregiverId: "caregiver-1",
  }, "caregiver-1"), true);
  assert.equal(isCareRequestVisibleToCaregiver({
    status: "open",
    requestedCaregiverId: "caregiver-1",
  }, "caregiver-2"), false);
});

test("calculates client age from ISO date of birth", () => {
  assert.equal(
    calculateAge("1952-05-15", new Date("2026-07-26T00:00:00.000Z")),
    74,
  );
});
