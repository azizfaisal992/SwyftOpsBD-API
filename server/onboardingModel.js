const profileFields = [
  "photo",
  "fullName",
  "dateOfBirth",
  "gender",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zipCode",
];

export const emptyOnboarding = (user) => ({
  caregiverId: user.uid,
  accountEmail: user.email || "",
  profile: {
    photo: null,
    fullName: user.name || "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    email: user.email || "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    serviceRadius: "25",
  },
  credentials: {
    resume: null,
    nidFront: null,
    nidBack: null,
    referenceLetter: null,
    licenses: {
      CRP: null,
      AHLC: null,
      RNLC: null,
    },
  },
  assessment: {
    emergency: "",
    ethics: "",
    hygiene: [],
  },
  profileCompleted: false,
  credentialsCompleted: false,
  assessmentSubmitted: false,
  verificationStatus: "draft",
  reviewFeedback: "",
  submittedAt: null,
  reviewedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  progress: 0,
});

const hasValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Boolean(value.name || value.storagePath);
  return Boolean(String(value || "").trim());
};

export const deriveOnboarding = (record) => {
  const completedProfileFields = profileFields.filter((field) => hasValue(record.profile[field])).length;
  const credentialValues = [
    record.credentials.resume,
    record.credentials.nidFront,
    record.credentials.nidBack,
  ];
  const assessmentValues = [
    record.assessment.emergency,
    record.assessment.ethics,
    record.assessment.hygiene,
  ];

  const profileCompleted = completedProfileFields === profileFields.length;
  const credentialsCompleted = credentialValues.every(hasValue);
  const profileProgress = (completedProfileFields / profileFields.length) * 35;
  const credentialProgress = (credentialValues.filter(hasValue).length / credentialValues.length) * 35;
  const assessmentProgress = (assessmentValues.filter(hasValue).length / assessmentValues.length) * 20;
  const approvalProgress = record.verificationStatus === "approved" ? 10 : 0;

  return {
    ...record,
    profileCompleted,
    credentialsCompleted,
    progress: Math.round(profileProgress + credentialProgress + assessmentProgress + approvalProgress),
    updatedAt: new Date().toISOString(),
  };
};

export const getOnboardingRecord = async (db, user) => {
  const reference = db.collection("caregiverOnboarding").doc(user.uid);
  const snapshot = await reference.get();
  if (snapshot.exists) return deriveOnboarding(snapshot.data());

  const record = emptyOnboarding(user);
  await reference.set(record);
  return record;
};

export const assertEditable = (record) => {
  if (["under_review", "approved"].includes(record.verificationStatus)) {
    const error = new Error("This onboarding submission is locked while it is under review.");
    error.status = 409;
    throw error;
  }
};

export const sanitizeProfile = (body = {}) => {
  const allowed = ["fullName", "dateOfBirth", "gender", "phone", "email", "address", "city", "state", "zipCode", "serviceRadius"];
  return Object.fromEntries(allowed.map((field) => [field, String(body[field] ?? "").trim()]));
};

export const sanitizeAssessment = (body = {}) => ({
  emergency: String(body.emergency || "").trim(),
  ethics: String(body.ethics || "").trim(),
  hygiene: Array.isArray(body.hygiene)
    ? [...new Set(body.hygiene.map((item) => String(item).trim()).filter(Boolean))].slice(0, 10)
    : [],
});
