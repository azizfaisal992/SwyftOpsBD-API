const CARE_TYPES = Object.freeze([
  "Senior Care",
  "Nursing Care",
  "Adult Care",
  "Child Care",
  "Housekeeping",
  "Pet Care",
  "Tutoring",
]);

const CARE_TASKS = Object.freeze([
  "Medication Reminders",
  "Mobility Assistance",
  "Meal Preparation",
  "Personal Hygiene",
  "Vitals Monitoring",
  "Dementia Care",
]);

const PREFERRED_TIMES = Object.freeze([
  "Mornings",
  "Afternoons",
  "Evenings",
  "Full Day",
]);

const PREFERRED_DAYS = Object.freeze([
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
]);

const GENDER_PREFERENCES = Object.freeze([
  "No Preference",
  "Female",
  "Male",
]);

const text = (value, maxLength = 500) =>
  String(value ?? "").trim().slice(0, maxLength);

const uniqueAllowed = (value, allowed, maxItems) =>
  Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, 80)))]
      .filter((item) => allowed.includes(item))
      .slice(0, maxItems)
    : [];

export const sanitizeCarePlan = (body = {}) => ({
  selectedCaregiverId: text(body.selectedCaregiverId, 128),
  selectedCaregiver: body.selectedCaregiver &&
    typeof body.selectedCaregiver === "object"
    ? {
        name: text(body.selectedCaregiver.name, 120),
        role: text(body.selectedCaregiver.role, 120),
        rate: Number(body.selectedCaregiver.rate) || 0,
        image: text(body.selectedCaregiver.image, 500),
      }
    : null,
  careType: text(body.careType, 80),
  tasks: uniqueAllowed(body.tasks, CARE_TASKS, CARE_TASKS.length),
  hoursPerWeek: Number(body.hoursPerWeek),
  preferredTime: text(body.preferredTime, 40),
  preferredStartTime: text(body.preferredStartTime, 5),
  serviceStartDate: text(body.serviceStartDate, 10),
  serviceEndDate: text(body.serviceEndDate, 10),
  preferredDays: uniqueAllowed(
    body.preferredDays,
    PREFERRED_DAYS,
    PREFERRED_DAYS.length,
  ),
  caregiverGender: text(body.caregiverGender, 40),
  budgetRange: text(body.budgetRange, 80),
  transportation: text(body.transportation, 500),
});

export const validateCarePlan = (plan) => {
  const fields = {};
  if (!CARE_TYPES.includes(plan.careType)) {
    fields.careType = "Select a supported care type.";
  }
  if (!plan.tasks.length) {
    fields.tasks = "Select at least one care task.";
  }
  if (
    !Number.isInteger(plan.hoursPerWeek) ||
    plan.hoursPerWeek < 4 ||
    plan.hoursPerWeek > 168
  ) {
    fields.hoursPerWeek = "Hours per week must be between 4 and 168.";
  }
  if (!PREFERRED_TIMES.includes(plan.preferredTime)) {
    fields.preferredTime = "Select a preferred time.";
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.preferredStartTime)) {
    fields.preferredStartTime = "Select a valid service start time.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.serviceStartDate)) {
    fields.serviceStartDate = "Select the first service date.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.serviceEndDate)) {
    fields.serviceEndDate = "Select the last service date.";
  } else if (
    /^\d{4}-\d{2}-\d{2}$/.test(plan.serviceStartDate) &&
    plan.serviceEndDate < plan.serviceStartDate
  ) {
    fields.serviceEndDate =
      "The last service date must be on or after the first date.";
  } else if (
    /^\d{4}-\d{2}-\d{2}$/.test(plan.serviceStartDate) &&
    (
      new Date(`${plan.serviceEndDate}T00:00:00.000Z`) -
      new Date(`${plan.serviceStartDate}T00:00:00.000Z`)
    ) / 86400000 > 365
  ) {
    fields.serviceEndDate = "A care period cannot exceed one year.";
  }
  if (!plan.preferredDays.length) {
    fields.preferredDays = "Select at least one preferred day.";
  }
  if (!GENDER_PREFERENCES.includes(plan.caregiverGender)) {
    fields.caregiverGender = "Select a caregiver gender preference.";
  }
  if (!plan.budgetRange) {
    fields.budgetRange = "Select a monthly budget range.";
  }
  return fields;
};

export const createCarePlan = ({
  clientId,
  data,
  now = new Date().toISOString(),
}) => ({
  clientId,
  ...data,
  status: "draft",
  requestId: null,
  createdAt: now,
  updatedAt: now,
  submittedAt: null,
});

export const buildCareRequest = ({
  id,
  plan,
  client,
  now = new Date().toISOString(),
}) => ({
  requestId: id,
  carePlanId: id,
  clientId: plan.clientId,
  client: {
    fullName: text(client.profile?.fullName, 120),
    dateOfBirth: text(client.profile?.dateOfBirth, 20),
    gender: text(client.profile?.gender, 40),
    phone: text(client.contact?.phone, 30),
    email: text(client.contact?.email, 160),
    area: text(client.contact?.area, 120),
    road: text(client.contact?.road, 160),
    house: text(client.contact?.house, 160),
    locationPinned: client.contact?.locationPinned === true,
    latitude: Number(client.contact?.latitude) || null,
    longitude: Number(client.contact?.longitude) || null,
    verified: client.verificationStatus === "approved",
  },
  careType: plan.careType,
  tasks: plan.tasks,
  hoursPerWeek: plan.hoursPerWeek,
  preferredTime: plan.preferredTime,
  preferredStartTime: plan.preferredStartTime,
  serviceStartDate: plan.serviceStartDate,
  serviceEndDate: plan.serviceEndDate,
  preferredDays: plan.preferredDays,
  caregiverGender: plan.caregiverGender,
  budgetRange: plan.budgetRange,
  transportation: plan.transportation,
  requestedCaregiverId: plan.selectedCaregiverId || null,
  requestedCaregiver: plan.selectedCaregiver || null,
  status: "open",
  paymentStatus: plan.paymentStatus || "pending",
  assignedCaregiverId: null,
  assignedAt: null,
  assignedBy: null,
  heldAt: null,
  declinedAt: null,
  createdAt: now,
  updatedAt: now,
});

export const isCareRequestVisibleToCaregiver = (request, caregiverId) =>
  request.status === "open" &&
  (
    !request.requestedCaregiverId ||
    request.requestedCaregiverId === caregiverId
  );

export const calculateAge = (dateOfBirth, today = new Date()) => {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (
      today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() < birth.getUTCDate()
    );
  if (beforeBirthday) age -= 1;
  return age;
};

export const CARE_REQUEST_STATUSES = Object.freeze([
  "open",
  "held",
  "assigned",
  "declined",
  "cancelled",
]);
