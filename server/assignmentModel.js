const DAY_NAMES = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
const START_HOURS = Object.freeze({
  Mornings: 9,
  Afternoons: 14,
  Evenings: 18,
  "Full Day": 8,
});

const text = (value, maxLength = 500) =>
  String(value ?? "").trim().slice(0, maxLength);

const roundHours = (value) => Math.round(value * 100) / 100;

const formatTime = (hour) => {
  const normalized = ((hour % 24) + 24) % 24;
  const whole = Math.floor(normalized);
  const minutes = Math.round((normalized - whole) * 60);
  const safeHour = minutes === 60 ? (whole + 1) % 24 : whole;
  const safeMinutes = minutes === 60 ? 0 : minutes;
  return `${String(safeHour).padStart(2, "0")}:${String(safeMinutes).padStart(2, "0")}`;
};

const addDays = (date, count) => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + count);
  return next.toISOString().slice(0, 10);
};

export const createAssignment = ({
  request,
  caregiver,
  caregiverId,
  accepted = false,
  assignedBy,
  now = new Date().toISOString(),
}) => ({
  assignmentId: request.requestId,
  requestId: request.requestId,
  carePlanId: request.carePlanId,
  clientId: request.clientId,
  caregiverId,
  client: {
    fullName: text(request.client?.fullName, 120),
    dateOfBirth: text(request.client?.dateOfBirth, 20),
    gender: text(request.client?.gender, 40),
    phone: text(request.client?.phone, 30),
    email: text(request.client?.email, 160),
    area: text(request.client?.area, 120),
    road: text(request.client?.road, 160),
    house: text(request.client?.house, 160),
    locationPinned: request.client?.locationPinned === true,
    latitude: Number(request.client?.latitude) || null,
    longitude: Number(request.client?.longitude) || null,
    verified: request.client?.verified === true,
  },
  caregiver: {
    fullName: text(caregiver.profile?.fullName, 120),
    gender: text(caregiver.profile?.gender, 40),
    phone: text(caregiver.profile?.phone, 30),
    email: text(caregiver.profile?.email, 160),
    city: text(caregiver.profile?.city, 120),
    photo: caregiver.profile?.photo || null,
  },
  careType: text(request.careType, 80),
  tasks: Array.isArray(request.tasks) ? request.tasks.slice(0, 20) : [],
  hoursPerWeek: Number(request.hoursPerWeek) || 0,
  preferredTime: text(request.preferredTime, 40),
  preferredStartTime: text(request.preferredStartTime, 5),
  serviceStartDate: text(request.serviceStartDate, 10),
  serviceEndDate: text(request.serviceEndDate, 10),
  preferredDays: Array.isArray(request.preferredDays)
    ? request.preferredDays.slice(0, 7)
    : [],
  transportation: text(request.transportation, 500),
  budgetRange: text(request.budgetRange, 80),
  timezone: "Asia/Dhaka",
  status: accepted ? "confirmed" : "pending_confirmation",
  confirmedAt: accepted ? now : null,
  assignedAt: now,
  assignedBy,
  updatedAt: now,
});

export const buildScheduledVisits = ({
  assignment,
  startDate = assignment.serviceStartDate ||
    new Date().toISOString().slice(0, 10),
  weeks = 4,
}) => {
  const preferredDays = new Set(assignment.preferredDays || []);
  if (!preferredDays.size) return [];
  const durationHours = roundHours(
    Math.min(24, Math.max(1, assignment.hoursPerWeek / preferredDays.size)),
  );
  const [selectedHour, selectedMinute] = String(
    assignment.preferredStartTime || "",
  )
    .split(":")
    .map(Number);
  const startHour =
    Number.isInteger(selectedHour) &&
    selectedHour >= 0 &&
    selectedHour <= 23 &&
    Number.isInteger(selectedMinute) &&
    selectedMinute >= 0 &&
    selectedMinute <= 59
      ? selectedHour + selectedMinute / 60
      : START_HOURS[assignment.preferredTime] ?? 9;
  const scheduledStartLocal = formatTime(startHour);
  const scheduledEndLocal = formatTime(startHour + durationHours);
  const visits = [];
  const configuredEnd = new Date(
    `${assignment.serviceEndDate || ""}T00:00:00.000Z`,
  );
  const configuredStart = new Date(`${startDate}T00:00:00.000Z`);
  const periodDays =
    !Number.isNaN(configuredEnd.getTime()) &&
    configuredEnd >= configuredStart
      ? Math.floor((configuredEnd - configuredStart) / 86400000) + 1
      : weeks * 7;

  for (let offset = 0; offset < periodDays; offset += 1) {
    const date = addDays(startDate, offset);
    const day = DAY_NAMES[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
    if (!preferredDays.has(day)) continue;
    const visitId = `${assignment.assignmentId}_${date}`;
    visits.push({
      visitId,
      assignmentId: assignment.assignmentId,
      requestId: assignment.requestId,
      clientId: assignment.clientId,
      caregiverId: assignment.caregiverId,
      clientName: assignment.client.fullName,
      caregiverName: assignment.caregiver.fullName,
      location: [
        assignment.client.house,
        assignment.client.road,
        assignment.client.area,
      ].filter(Boolean).join(", "),
      serviceLocation:
        Number.isFinite(assignment.client.latitude) &&
        Number.isFinite(assignment.client.longitude)
          ? {
              latitude: assignment.client.latitude,
              longitude: assignment.client.longitude,
            }
          : null,
      careType: assignment.careType,
      tasks: assignment.tasks,
      date,
      day,
      scheduledStartLocal,
      scheduledEndLocal,
      serviceStartDate: assignment.serviceStartDate || startDate,
      serviceEndDate: assignment.serviceEndDate || null,
      durationHours,
      endsNextDay: startHour + durationHours >= 24,
      timezone: assignment.timezone,
      status: "scheduled",
      confirmationStatus:
        assignment.status === "confirmed" ? "confirmed" : "pending",
      clockInAt: null,
      clockOutAt: null,
      createdAt: assignment.assignedAt,
      updatedAt: assignment.updatedAt,
    });
  }
  return visits;
};

export const ASSIGNMENT_STATUSES = Object.freeze([
  "pending_confirmation",
  "confirmed",
  "active",
  "completed",
  "cancelled",
]);
