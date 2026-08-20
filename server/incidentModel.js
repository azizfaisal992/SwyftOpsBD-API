import { validationError } from "./errors/ApiError.js";

export const INCIDENT_TYPES = Object.freeze([
  "sos",
  "service_complaint",
  "payment_dispute",
  "no_show",
]);

export const INCIDENT_STATUSES = Object.freeze([
  "open",
  "in_review",
  "escalated",
  "resolved",
]);

const TYPE_DEFAULTS = Object.freeze({
  sos: { label: "Emergency SOS", severity: "critical" },
  service_complaint: { label: "Service Complaint", severity: "high" },
  payment_dispute: { label: "Payment Dispute", severity: "normal" },
  no_show: { label: "Caregiver No-show", severity: "high" },
});

const cleanText = (value, maximum = 1000) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

const cleanLocation = (value) => {
  if (!value || typeof value !== "object") return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < 20.5 ||
    latitude > 26.7 ||
    longitude < 88 ||
    longitude > 92.8
  ) {
    throw validationError("The incident location must be inside Bangladesh.", {
      location: "Provide valid Bangladesh latitude and longitude.",
    });
  }
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(value.accuracy))
      ? Math.max(0, Number(value.accuracy))
      : null,
    capturedAt: cleanText(value.capturedAt, 60) || null,
  };
};

export const buildIncident = ({
  body,
  id,
  now = new Date().toISOString(),
  reporter,
  visit = null,
  transaction = null,
}) => {
  const type = cleanText(body?.type, 40).toLowerCase();
  if (!INCIDENT_TYPES.includes(type)) {
    throw validationError("Select a supported incident type.", {
      type: `Use one of: ${INCIDENT_TYPES.join(", ")}.`,
    });
  }

  const description = cleanText(body?.description, 2000);
  if (type !== "sos" && description.length < 10) {
    throw validationError("Describe the incident in at least 10 characters.", {
      description: "At least 10 characters are required.",
    });
  }

  const defaults = TYPE_DEFAULTS[type];
  const clientId =
    visit?.clientId || (reporter.role === "client" ? reporter.uid : null);
  const caregiverId =
    visit?.caregiverId || (reporter.role === "caregiver" ? reporter.uid : null);

  return {
    incidentId: id,
    type,
    label: defaults.label,
    title: cleanText(body?.title, 160) || defaults.label,
    description:
      description ||
      "Emergency assistance requested from the active care session.",
    severity: defaults.severity,
    status: type === "sos" ? "in_review" : "open",
    reporterId: reporter.uid,
    reporterRole: reporter.role,
    reporterName: cleanText(reporter.name, 160) || reporter.email || "User",
    clientId,
    caregiverId,
    visitId: visit?.visitId || visit?.id || null,
    assignmentId: visit?.assignmentId || null,
    transactionId: transaction?.transactionId || transaction?.id || null,
    location: cleanLocation(body?.location),
    assignedAdminId: null,
    assignedAdminName: null,
    resolution: null,
    resolutionNotes: null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    timeline: [
      {
        event: type === "sos" ? "sos_triggered" : "incident_reported",
        title: type === "sos" ? "SOS Triggered" : "Incident Reported",
        description:
          description ||
          "Emergency assistance requested from the active care session.",
        actorId: reporter.uid,
        actorRole: reporter.role,
        createdAt: now,
      },
    ],
  };
};

export const buildIncidentAction = ({
  action,
  body,
  incident,
  now = new Date().toISOString(),
  user,
}) => {
  const normalized = cleanText(action, 30).toLowerCase();
  const allowed = ["assign", "review", "escalate", "resolve", "reopen"];
  if (!allowed.includes(normalized)) {
    throw validationError("Select a supported incident action.", {
      action: `Use one of: ${allowed.join(", ")}.`,
    });
  }

  const status = {
    assign: incident.status,
    review: "in_review",
    escalate: "escalated",
    resolve: "resolved",
    reopen: "in_review",
  }[normalized];
  const resolution = cleanText(body?.resolution, 120);
  const notes = cleanText(body?.notes, 2000);
  if (normalized === "resolve" && (!resolution || notes.length < 10)) {
    throw validationError(
      "A resolution and at least 10 characters of notes are required.",
      {
        resolution: !resolution ? "Select a resolution." : undefined,
        notes: notes.length < 10 ? "At least 10 characters are required." : undefined,
      },
    );
  }

  const title = {
    assign: "Handler Assigned",
    review: "Status Changed: In Review",
    escalate: "Incident Escalated",
    resolve: "Incident Resolved",
    reopen: "Incident Reopened",
  }[normalized];

  return {
    status,
    assignedAdminId:
      normalized === "assign" || !incident.assignedAdminId
        ? user.uid
        : incident.assignedAdminId,
    assignedAdminName:
      normalized === "assign" || !incident.assignedAdminName
        ? user.name || user.email || "Administrator"
        : incident.assignedAdminName,
    resolution: normalized === "resolve" ? resolution : null,
    resolutionNotes: normalized === "resolve" ? notes : null,
    resolvedAt: normalized === "resolve" ? now : null,
    updatedAt: now,
    timeline: [
      ...(Array.isArray(incident.timeline) ? incident.timeline : []),
      {
        event: normalized,
        title,
        description:
          notes ||
          (normalized === "assign"
            ? "The incident was assigned to an administrator."
            : `Incident status changed to ${status.replace("_", " ")}.`),
        actorId: user.uid,
        actorRole: user.role,
        createdAt: now,
      },
    ],
  };
};
