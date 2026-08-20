import assert from "node:assert/strict";
import test from "node:test";
import { buildIncident, buildIncidentAction } from "./incidentModel.js";

test("builds an SOS incident with derived visit participants", () => {
  const incident = buildIncident({
    id: "incident-1",
    now: "2026-07-29T10:00:00.000Z",
    body: {
      type: "sos",
      location: { latitude: 23.8103, longitude: 90.4125 },
    },
    reporter: { uid: "caregiver-1", role: "caregiver", name: "Rahima" },
    visit: {
      visitId: "visit-1",
      assignmentId: "assignment-1",
      clientId: "client-1",
      caregiverId: "caregiver-1",
    },
  });

  assert.equal(incident.status, "in_review");
  assert.equal(incident.severity, "critical");
  assert.equal(incident.clientId, "client-1");
  assert.equal(incident.caregiverId, "caregiver-1");
  assert.equal(incident.timeline[0].event, "sos_triggered");
});

test("requires resolution evidence before resolving", () => {
  assert.throws(
    () =>
      buildIncidentAction({
        action: "resolve",
        body: { resolution: "", notes: "short" },
        incident: { status: "in_review", timeline: [] },
        user: { uid: "admin-1", role: "super_admin" },
      }),
    /resolution/i,
  );
});

test("adds an immutable-style audit timeline event", () => {
  const update = buildIncidentAction({
    action: "escalate",
    body: { notes: "Emergency desk was contacted." },
    incident: {
      status: "in_review",
      timeline: [{ event: "sos_triggered" }],
    },
    now: "2026-07-29T10:05:00.000Z",
    user: { uid: "admin-1", role: "super_admin", name: "Admin" },
  });

  assert.equal(update.status, "escalated");
  assert.equal(update.timeline.length, 2);
  assert.equal(update.timeline[1].event, "escalate");
});
