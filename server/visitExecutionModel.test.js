import assert from "node:assert/strict";
import test from "node:test";
import {
  completeShift,
  completeVisit,
  startShift,
  startVisit,
  updateShiftLocation,
  updateVisitLocation,
  updateVisitProgress,
} from "./visitExecutionModel.js";

const scheduledVisit = {
  visitId: "visit-1",
  caregiverId: "caregiver-1",
  status: "scheduled",
  confirmationStatus: "confirmed",
  tasks: ["Medication", "Mobility"],
  clockInAt: null,
  serviceLocation: { latitude: 23.81, longitude: 90.41 },
};

test("starts a confirmed scheduled visit with server time and GPS", () => {
  const visit = startVisit(scheduledVisit, {
    now: "2026-07-27T08:00:00.000Z",
    location: { latitude: 23.81, longitude: 90.41, accuracy: 12 },
  });
  assert.equal(visit.status, "active");
  assert.equal(visit.clockInLocation.latitude, 23.81);
  assert.equal(visit.withinGeofence, true);
  assert.equal(visit.distanceFromServiceMeters, 0);
});

test("records a geofence warning without blocking visit start", () => {
  const visit = startVisit(scheduledVisit, {
    now: "2026-07-27T08:00:00.000Z",
    location: { latitude: 23.82, longitude: 90.42, accuracy: 12 },
  });
  assert.equal(visit.status, "active");
  assert.equal(visit.withinGeofence, false);
  assert.ok(visit.distanceFromServiceMeters > 150);
});

test("updates an active visit GPS location and geofence state", () => {
  const active = startVisit(scheduledVisit, {
    now: "2026-07-27T08:00:00.000Z",
    location: { latitude: 23.81, longitude: 90.41 },
  });
  const updated = updateVisitLocation(active, {
    now: "2026-07-27T08:05:00.000Z",
    location: { latitude: 23.82, longitude: 90.42, accuracy: 10 },
  });
  assert.equal(updated.currentLocation.latitude, 23.82);
  assert.equal(updated.lastLocationAt, "2026-07-27T08:05:00.000Z");
  assert.equal(updated.withinGeofence, false);
});

test("saves only tasks assigned to the active visit", () => {
  const active = startVisit(scheduledVisit);
  const updated = updateVisitProgress(active, {
    completedTasks: ["Medication"],
    careNotes: "Client is stable.",
  });
  assert.deepEqual(updated.completedTasks, ["Medication"]);
  assert.equal(updated.careNotes, "Client is stable.");
  assert.throws(
    () => updateVisitProgress(active, { completedTasks: ["Unknown"] }),
    /not assigned/,
  );
});

test("completes an active visit and derives duration", () => {
  const active = startVisit(scheduledVisit, {
    now: "2026-07-27T08:00:00.000Z",
  });
  const completed = completeVisit(active, {
    completedTasks: ["Medication", "Mobility"],
    careNotes: "All tasks completed.",
    now: "2026-07-27T09:30:00.000Z",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.durationSeconds, 5400);
  assert.ok(completed.reportSubmittedAt);
});

test("starts and completes a caregiver shift", () => {
  const shift = startShift({
    shiftId: "shift-1",
    caregiverId: "caregiver-1",
    caregiverName: "Care Giver",
    now: "2026-07-27T08:00:00.000Z",
  });
  const completed = completeShift(shift, {
    now: "2026-07-27T16:00:00.000Z",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.durationSeconds, 28800);
});

test("updates the location of an active caregiver shift", () => {
  const shift = startShift({
    shiftId: "shift-2",
    caregiverId: "caregiver-1",
    now: "2026-07-27T08:00:00.000Z",
  });
  const updated = updateShiftLocation(shift, {
    now: "2026-07-27T08:15:00.000Z",
    location: { latitude: 23.81, longitude: 90.41 },
  });
  assert.equal(updated.currentLocation.longitude, 90.41);
  assert.equal(updated.lastLocationAt, "2026-07-27T08:15:00.000Z");
});
