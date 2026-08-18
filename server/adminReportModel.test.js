import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminReport } from "./adminReportModel.js";

test("builds a date-bounded report from operational and financial records", () => {
  const report = buildAdminReport({
    range: "30d",
    now: new Date("2026-07-29T10:00:00.000Z"),
    caregivers: [
      { verificationStatus: "approved", accountStatus: "active" },
      { verificationStatus: "approved", accountStatus: "suspended" },
    ],
    clients: [{ verificationStatus: "approved" }],
    visits: [
      {
        careType: "Nursing Care",
        status: "completed",
        date: "2026-07-28",
        clockOutAt: "2026-07-28T10:00:00.000Z",
        durationSeconds: 7200,
        tasks: ["Medication", "Vitals"],
        completedTasks: ["Medication"],
        withinGeofence: true,
      },
      {
        careType: "Nursing Care",
        status: "scheduled",
        date: "2026-07-29",
      },
    ],
    transactions: [{
      status: "successful",
      amount: 1000,
      careType: "Nursing Care",
      completedAt: "2026-07-28T11:00:00.000Z",
    }],
    payouts: [{
      status: "paid",
      amount: 800,
      paidAt: "2026-07-28T12:00:00.000Z",
    }],
    platformRevenue: [{
      status: "realized",
      amount: 200,
      realizedAt: "2026-07-28T12:00:00.000Z",
    }],
    incidents: [{
      status: "resolved",
      createdAt: "2026-07-28T09:00:00.000Z",
    }],
    careRequests: [{
      status: "open",
      createdAt: "2026-07-27T09:00:00.000Z",
    }],
  });

  assert.equal(report.summary.grossRevenue, 1000);
  assert.equal(report.summary.caregiverPayouts, 800);
  assert.equal(report.summary.platformNetRevenue, 200);
  assert.equal(report.summary.completedVisits, 1);
  assert.equal(report.summary.careHours, 2);
  assert.equal(report.summary.activeCaregivers, 1);
  assert.equal(report.summary.activeClients, 1);
  assert.equal(report.summary.openRequests, 1);
  assert.equal(report.quality.visitCompletion, 50);
  assert.equal(report.quality.taskCompletion, 50);
  assert.equal(report.quality.geofenceCompliance, 100);
  assert.equal(report.quality.incidentResolution, 100);
  assert.equal(report.servicePerformance[0].service, "Nursing Care");
  assert.equal(report.servicePerformance[0].revenue, 1000);
  assert.equal(report.trends.length, 6);
});

