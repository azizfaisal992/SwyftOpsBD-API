const profileFields = ["fullName", "dateOfBirth", "gender", "nidNumber"];
const contactFields = ["phone", "email", "area", "road", "house"];

const hasValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") {
    return Boolean(value.name || value.storagePath);
  }
  return Boolean(String(value ?? "").trim());
};

export const emptyClientOnboarding = (user) => ({
  clientId: user.uid,
  accountEmail: user.email || "",
  profile: {
    fullName: user.name || "",
    dateOfBirth: "",
    gender: "",
    nidNumber: "",
  },
  contact: {
    phone: "",
    email: user.email || "",
    area: "",
    road: "",
    house: "",
    locationPinned: false,
    latitude: null,
    longitude: null,
  },
  documents: {
    nidFront: null,
    nidBack: null,
    medicalReports: [],
  },
  profileCompleted: false,
  contactCompleted: false,
  documentsCompleted: false,
  confirmed: false,
  submitted: false,
  verificationStatus: "draft",
  reviewFeedback: "",
  submittedAt: null,
  reviewedAt: null,
  reviewedBy: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  progress: 0,
});

export const deriveClientOnboarding = (record) => {
  const completedProfileFields = profileFields.filter((field) =>
    hasValue(record.profile?.[field])).length;
  const completedContactFields = contactFields.filter((field) =>
    hasValue(record.contact?.[field])).length;
  const profileCompleted = completedProfileFields === profileFields.length;
  const contactCompleted =
    completedContactFields === contactFields.length &&
    record.contact?.locationPinned === true &&
    Number.isFinite(Number(record.contact?.latitude)) &&
    Number.isFinite(Number(record.contact?.longitude));
  const documentsCompleted =
    hasValue(record.documents?.nidFront) &&
    hasValue(record.documents?.nidBack);

  const profileProgress =
    (completedProfileFields / profileFields.length) * 30;
  const contactProgress =
    ((completedContactFields + (record.contact?.locationPinned ? 1 : 0)) /
      (contactFields.length + 1)) * 30;
  const documentProgress =
    ([record.documents?.nidFront, record.documents?.nidBack]
      .filter(hasValue).length / 2) * 30;
  const approvalProgress = record.verificationStatus === "approved" ? 10 : 0;

  return {
    ...record,
    profileCompleted,
    contactCompleted,
    documentsCompleted,
    progress: Math.round(
      profileProgress +
      contactProgress +
      documentProgress +
      approvalProgress,
    ),
    updatedAt: new Date().toISOString(),
  };
};

export const getClientOnboardingRecord = async (db, user) => {
  const reference = db.collection("clientOnboarding").doc(user.uid);
  const snapshot = await reference.get();
  if (snapshot.exists) {
    const defaults = emptyClientOnboarding(user);
    const saved = snapshot.data();
    return deriveClientOnboarding({
      ...defaults,
      ...saved,
      profile: { ...defaults.profile, ...saved.profile },
      contact: { ...defaults.contact, ...saved.contact },
      documents: {
        ...defaults.documents,
        ...saved.documents,
        medicalReports: saved.documents?.medicalReports || [],
      },
    });
  }

  const record = emptyClientOnboarding(user);
  await reference.set(record);
  return record;
};

export const assertClientOnboardingEditable = (record) => {
  if (["under_review", "approved", "rejected"].includes(record.verificationStatus)) {
    const error = new Error(
      "This client verification submission is locked while it is under review.",
    );
    error.status = 409;
    throw error;
  }
};

export const sanitizeClientProfile = (body = {}) => ({
  fullName: String(body.fullName ?? "").trim(),
  dateOfBirth: String(body.dateOfBirth ?? "").trim(),
  gender: String(body.gender ?? "").trim(),
  nidNumber: String(body.nidNumber ?? "").replace(/\s+/g, ""),
});

export const sanitizeClientContact = (body = {}) => ({
  phone: String(body.phone ?? "").trim(),
  email: String(body.email ?? "").trim().toLowerCase(),
  area: String(body.area ?? "").trim(),
  road: String(body.road ?? "").trim(),
  house: String(body.house ?? "").trim(),
  latitude: Number.isFinite(Number(body.latitude))
    ? Number(body.latitude)
    : null,
  longitude: Number.isFinite(Number(body.longitude))
    ? Number(body.longitude)
    : null,
  locationPinned:
    body.locationPinned === true &&
    Number.isFinite(Number(body.latitude)) &&
    Number.isFinite(Number(body.longitude)),
});
