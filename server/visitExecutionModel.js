import { conflict, validationError } from "./errors/ApiError.js";

const text = (value, maxLength = 5000) =>
  String(value ?? "").trim().slice(0, maxLength);

const validCoordinate = (value, minimum, maximum) =>
  Number.isFinite(Number(value)) &&
  Number(value) >= minimum &&
  Number(value) <= maximum;

export const sanitizeLocation = (location) => {
  if (!location) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy);
  if (
    !validCoordinate(latitude, -90, 90) ||
    !validCoordinate(longitude, -180, 180)
  ) {
    throw validationError("The GPS coordinates are invalid.", {
      location: "Provide a valid latitude and longitude.",
    });
  }
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    capturedAt: text(location.capturedAt, 40) || null,
  };
};

export const distanceBetweenLocations = (first, second) => {
  if (!first || !second) return null;
  const a = sanitizeLocation(first);
  const b = sanitizeLocation(second);
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(
    earthRadiusMeters * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)),
  );
};

export const startVisit = (
  visit,
  { location = null, now = new Date().toISOString() } = {},
) => {
  if (visit.status === "active") return visit;
  if (visit.status !== "scheduled") {
    throw conflict("Only a scheduled visit can be started.");
  }
  if (visit.confirmationStatus !== "confirmed") {
    throw conflict("The assignment must be confirmed before this visit starts.");
  }
  const clockInLocation = sanitizeLocation(location);
  const distanceFromServiceMeters = distanceBetweenLocations(
    clockInLocation,
    visit.serviceLocation,
  );
  return {
    ...visit,
    status: "active",
    clockInAt: now,
    clockInLocation,
    currentLocation: clockInLocation,
    lastLocationAt: clockInLocation ? now : null,
    distanceFromServiceMeters,
    geofenceRadiusMeters: 150,
    withinGeofence:
      distanceFromServiceMeters === null
        ? null
        : distanceFromServiceMeters <= 150,
    completedTasks: Array.isArray(visit.completedTasks)
      ? visit.completedTasks
      : [],
    careNotes: text(visit.careNotes),
    updatedAt: now,
  };
};

export const updateVisitProgress = (
  visit,
  { completedTasks = [], careNotes = "", now = new Date().toISOString() } = {},
) => {
  if (visit.status !== "active") {
    throw conflict("Visit progress can only be saved during an active visit.");
  }
  const allowedTasks = new Set(visit.tasks || []);
  const invalidTasks = completedTasks.filter((task) => !allowedTasks.has(task));
  if (invalidTasks.length) {
    throw validationError("One or more completed tasks are not assigned.", {
      completedTasks: "Only assigned care tasks may be completed.",
    });
  }
  return {
    ...visit,
    completedTasks: [...new Set(completedTasks)],
    careNotes: text(careNotes),
    updatedAt: now,
  };
};

export const updateVisitLocation = (
  visit,
  { location, now = new Date().toISOString() } = {},
) => {
  if (visit.status !== "active") {
    throw conflict("GPS can only be updated during an active visit.");
  }
  const currentLocation = sanitizeLocation(location);
  if (!currentLocation) {
    throw validationError("A GPS location is required.", {
      location: "Provide the caregiver's current latitude and longitude.",
    });
  }
  const distanceFromServiceMeters = distanceBetweenLocations(
    currentLocation,
    visit.serviceLocation,
  );
  return {
    ...visit,
    currentLocation,
    lastLocationAt: now,
    distanceFromServiceMeters,
    withinGeofence:
      distanceFromServiceMeters === null
        ? null
        : distanceFromServiceMeters <= (visit.geofenceRadiusMeters || 150),
    updatedAt: now,
  };
};

export const completeVisit = (
  visit,
  {
    completedTasks = [],
    careNotes = "",
    location = null,
    now = new Date().toISOString(),
  } = {},
) => {
  const progressed = updateVisitProgress(visit, {
    completedTasks,
    careNotes,
    now,
  });
  const startedAt = new Date(progressed.clockInAt).getTime();
  const endedAt = new Date(now).getTime();
  return {
    ...progressed,
    status: "completed",
    clockOutAt: now,
    clockOutLocation: sanitizeLocation(location),
    durationSeconds:
      Number.isFinite(startedAt) && Number.isFinite(endedAt)
        ? Math.max(0, Math.floor((endedAt - startedAt) / 1000))
        : 0,
    reportSubmittedAt: now,
    updatedAt: now,
  };
};

export const startShift = ({
  caregiverId,
  caregiverName = "",
  location = null,
  now = new Date().toISOString(),
  shiftId,
}) => {
  const startLocation = sanitizeLocation(location);
  return {
    shiftId,
    caregiverId,
    caregiverName: text(caregiverName, 120),
    status: "active",
    startedAt: now,
    startLocation,
    currentLocation: startLocation,
    lastLocationAt: startLocation ? now : null,
    endedAt: null,
    endLocation: null,
    durationSeconds: null,
    createdAt: now,
    updatedAt: now,
  };
};

export const completeShift = (
  shift,
  { location = null, now = new Date().toISOString() } = {},
) => {
  if (shift.status !== "active") {
    throw conflict("Only an active shift can be clocked out.");
  }
  const startedAt = new Date(shift.startedAt).getTime();
  const endedAt = new Date(now).getTime();
  return {
    ...shift,
    status: "completed",
    endedAt: now,
    endLocation: sanitizeLocation(location),
    durationSeconds:
      Number.isFinite(startedAt) && Number.isFinite(endedAt)
        ? Math.max(0, Math.floor((endedAt - startedAt) / 1000))
        : 0,
    updatedAt: now,
  };
};

export const updateShiftLocation = (
  shift,
  { location, now = new Date().toISOString() } = {},
) => {
  if (shift.status !== "active") {
    throw conflict("GPS can only be updated during an active shift.");
  }
  const currentLocation = sanitizeLocation(location);
  if (!currentLocation) {
    throw validationError("A GPS location is required.", {
      location: "Provide the caregiver's current latitude and longitude.",
    });
  }
  return {
    ...shift,
    currentLocation,
    lastLocationAt: now,
    updatedAt: now,
  };
};
