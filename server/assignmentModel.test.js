import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduledVisits,
  createAssignment,
} from "./assignmentModel.js";

const careRequest = {
  requestId: "request-1",
  carePlanId: "plan-1",
  clientId: "client-1",
  client: {
    fullName: "Client One",
    phone: "01700000000",
    email: "client@example.com",
    area: "Dhanmondi",
    verified: true,
  },
  careType: "Senior Care",
  tasks: ["Medication Reminders"],
  hoursPerWeek: 6,
  preferredTime: "Mornings",
  preferredStartTime: "09:30",
  serviceStartDate: "2026-07-27",
  serviceEndDate: "2026-08-23",
  preferredDays: ["Mon", "Wed", "Fri"],
  budgetRange: "৳15,000 - ৳25,000",
};

const caregiver = {
  profile: {
    fullName: "Care Giver",
    phone: "01800000000",
    email: "caregiver@example.com",
    city: "Dhaka",
  },
};

test("creates a pending assignment when the caregiver has not accepted", () => {
  const assignment = createAssignment({
    request: careRequest,
    caregiver,
    caregiverId: "caregiver-1",
    accepted: false,
    assignedBy: "admin-1",
    now: "2026-07-26T00:00:00.000Z",
  });
  assert.equal(assignment.assignmentId, "request-1");
  assert.equal(assignment.status, "pending_confirmation");
  assert.equal(assignment.confirmedAt, null);
});

test("creates four weeks of visits on selected service days", () => {
  const assignment = createAssignment({
    request: careRequest,
    caregiver,
    caregiverId: "caregiver-1",
    accepted: true,
    assignedBy: "admin-1",
    now: "2026-07-26T00:00:00.000Z",
  });
  const visits = buildScheduledVisits({
    assignment,
    startDate: "2026-07-27",
  });
  assert.equal(visits.length, 12);
  assert.deepEqual(
    [...new Set(visits.map((visit) => visit.day))],
    ["Mon", "Wed", "Fri"],
  );
  assert.equal(visits[0].scheduledStartLocal, "09:30");
  assert.equal(visits[0].durationHours, 2);
  assert.equal(visits[0].confirmationStatus, "confirmed");
  assert.equal(visits[0].serviceStartDate, "2026-07-27");
  assert.equal(visits.at(-1).serviceEndDate, "2026-08-23");
});

test("never exposes more than twenty four hours in one generated visit", () => {
  const assignment = createAssignment({
    request: {
      ...careRequest,
      hoursPerWeek: 168,
      preferredDays: ["Mon"],
      preferredTime: "Full Day",
    },
    caregiver,
    caregiverId: "caregiver-1",
    accepted: false,
    assignedBy: "admin-1",
  });
  const [visit] = buildScheduledVisits({
    assignment,
    startDate: "2026-07-27",
    weeks: 1,
  });
  assert.equal(visit.durationHours, 24);
  assert.equal(visit.endsNextDay, true);
});
