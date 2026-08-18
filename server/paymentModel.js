import { validationError } from "./errors/ApiError.js";

export const INVOICE_STATUSES = Object.freeze([
  "locked",
  "draft",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "refunded",
]);

export const PAYOUT_STATUSES = Object.freeze([
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
]);

const text = (value, maxLength = 500) =>
  String(value ?? "").trim().slice(0, maxLength);

export const money = (value) => Math.round(Number(value) * 100) / 100;

const paymentCurrency = () =>
  String(process.env.PAYMENT_CURRENCY || "BDT").trim().toUpperCase();

export const STAGED_PAYMENT_POLICY = Object.freeze({
  depositPercent: 35,
  balancePercent: 65,
  caregiverSharePercent: 85,
  caregiverAdvancePercent: 35,
});

const HOURLY_RATES = Object.freeze({
  "Senior Care": 850,
  "Nursing Care": 1000,
  "Adult Care": 800,
  "Child Care": 700,
  Housekeeping: 500,
  "Pet Care": 450,
  Tutoring: 600,
});

export const calculateCarePlanPricing = (plan) => {
  const hourlyRate =
    Number(plan?.selectedCaregiver?.rate) || HOURLY_RATES[plan?.careType];
  const hoursPerWeek = Number(plan?.hoursPerWeek);
  if (!hourlyRate || !Number.isFinite(hoursPerWeek) || hoursPerWeek <= 0) {
    throw validationError("The care plan cannot be priced.", {
      carePlan: "Select a supported care type and valid weekly hours.",
    });
  }
  const start = new Date(`${plan?.serviceStartDate || ""}T00:00:00.000Z`);
  const end = new Date(`${plan?.serviceEndDate || ""}T00:00:00.000Z`);
  const preferredDays = new Set(plan?.preferredDays || []);
  const hasPeriod =
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    end >= start &&
    preferredDays.size > 0;
  let visitCount = 0;
  let billingDays = 28;
  if (hasPeriod) {
    billingDays = Math.floor((end - start) / 86400000) + 1;
    for (
      const cursor = new Date(start);
      cursor <= end;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        cursor.getUTCDay()
      ];
      if (preferredDays.has(day)) visitCount += 1;
    }
  }
  const totalServiceHours = hasPeriod
    ? money(visitCount * (hoursPerWeek / preferredDays.size))
    : money(hoursPerWeek * 4);
  const serviceSubtotal = money(hourlyRate * totalServiceHours);
  const medicalPremium = plan.careType === "Nursing Care" ? 5000 : 2500;
  const platformFee = 2500;
  const total = money(serviceSubtotal + medicalPremium + platformFee);
  const depositAmount = money(
    total * STAGED_PAYMENT_POLICY.depositPercent / 100,
  );
  const balanceAmount = money(total - depositAmount);
  const caregiverEarning = money(
    serviceSubtotal * STAGED_PAYMENT_POLICY.caregiverSharePercent / 100,
  );
  const platformRevenue = money(
    serviceSubtotal - caregiverEarning + platformFee,
  );
  return {
    currency: paymentCurrency(),
    hourlyRate,
    hoursPerWeek,
    billingDays,
    billingWeeks: money(billingDays / 7),
    visitCount: hasPeriod ? visitCount : null,
    totalServiceHours,
    serviceStartDate: plan?.serviceStartDate || null,
    serviceEndDate: plan?.serviceEndDate || null,
    serviceSubtotal,
    medicalPremium,
    platformFee,
    total,
    depositPercent: STAGED_PAYMENT_POLICY.depositPercent,
    depositAmount,
    balancePercent: STAGED_PAYMENT_POLICY.balancePercent,
    balanceAmount,
    caregiverSharePercent: STAGED_PAYMENT_POLICY.caregiverSharePercent,
    caregiverEarning,
    platformRevenue,
    medicalReserve: medicalPremium,
  };
};

export const createBillingAgreement = ({
  agreementId,
  plan,
  clientName = "",
  now = new Date().toISOString(),
}) => ({
  agreementId,
  carePlanId: plan.carePlanId,
  clientId: plan.clientId,
  clientName: text(clientName, 120),
  careType: plan.careType,
  pricing: calculateCarePlanPricing(plan),
  status: "deposit_pending",
  depositStatus: "pending",
  balanceStatus: "locked",
  serviceStatus: "awaiting_assignment",
  settlementStatus: "pending",
  assignmentId: null,
  caregiverId: null,
  caregiverName: "",
  depositInvoiceId: null,
  balanceInvoiceId: null,
  createdAt: now,
  updatedAt: now,
  depositPaidAt: null,
  serviceCompletedAt: null,
  balancePaidAt: null,
  settledAt: null,
});

export const createStageInvoice = ({
  invoiceId,
  agreement,
  stage,
  createdBy,
  now = new Date().toISOString(),
}) => {
  if (!["deposit", "balance"].includes(stage)) {
    throw validationError("Select a valid payment stage.", {
      stage: "Use deposit or balance.",
    });
  }
  const isDeposit = stage === "deposit";
  return {
    invoiceId,
    billingAgreementId: agreement.agreementId,
    carePlanId: agreement.carePlanId,
    assignmentId: agreement.assignmentId,
    clientId: agreement.clientId,
    clientName: agreement.clientName,
    stage,
    description: `${agreement.careType} — ${isDeposit ? "35% booking deposit" : "65% completion balance"}`,
    subtotal: isDeposit
      ? agreement.pricing.depositAmount
      : agreement.pricing.balanceAmount,
    medicalPremium: 0,
    platformFee: 0,
    vat: 0,
    currency: agreement.pricing.currency || paymentCurrency(),
    total: isDeposit
      ? agreement.pricing.depositAmount
      : agreement.pricing.balanceAmount,
    amountPaid: 0,
    status: isDeposit ? "pending" : "locked",
    gateway: null,
    transactionId: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  };
};

export const completeStagedSettlement = ({
  agreement,
  ledgerId,
  revenueId,
  transactionId,
  now = new Date().toISOString(),
}) => {
  if (
    agreement.serviceStatus !== "completed" ||
    agreement.balanceStatus !== "paid" ||
    !agreement.caregiverId
  ) {
    throw validationError("This care agreement is not ready for settlement.", {
      settlement: "Complete the service and final payment first.",
    });
  }
  const releasedAdvance = money(
    agreement.caregiverAdvanceStatus === "released"
      ? agreement.caregiverAdvanceAmount || 0
      : 0,
  );
  const remainingCaregiverEarning = money(
    agreement.pricing.caregiverEarning - releasedAdvance,
  );
  return {
    agreement: {
      ...agreement,
      status: "settled",
      settlementStatus: "completed",
      caregiverFinalAmount: remainingCaregiverEarning,
      settledAt: now,
      updatedAt: now,
    },
    caregiverEntry: createEarning({
      ledgerId,
      caregiverId: agreement.caregiverId,
      caregiverName: agreement.caregiverName,
      amount: remainingCaregiverEarning,
      description: releasedAdvance > 0
        ? `${agreement.careType} — remaining 65% caregiver settlement`
        : `${agreement.careType} subscription settlement`,
      assignmentId: agreement.assignmentId,
      clientId: agreement.clientId,
      clientName: agreement.clientName,
      createdBy: "system",
      now,
    }),
    platformEntry: {
      revenueId,
      agreementId: agreement.agreementId,
      carePlanId: agreement.carePlanId,
      assignmentId: agreement.assignmentId,
      transactionId,
      type: "platform_revenue",
      serviceCommission: money(
        agreement.pricing.serviceSubtotal -
        agreement.pricing.caregiverEarning,
      ),
      platformFee: agreement.pricing.platformFee,
      amount: agreement.pricing.platformRevenue,
      medicalReserve: agreement.pricing.medicalReserve,
      currency: agreement.pricing.currency || paymentCurrency(),
      status: "realized",
      createdAt: now,
      updatedAt: now,
    },
  };
};

export const sanitizeInvoice = (body = {}) => ({
  clientId: text(body.clientId, 128),
  clientName: text(body.clientName, 120),
  assignmentId: text(body.assignmentId, 128) || null,
  carePlanId: text(body.carePlanId, 128) || null,
  description: text(body.description, 240),
  subtotal: money(body.subtotal),
  medicalPremium: money(body.medicalPremium || 0),
  platformFee: money(body.platformFee || 0),
  vat: money(body.vat || 0),
  dueAt: text(body.dueAt, 40),
  note: text(body.note, 1000),
});

export const validateInvoice = (invoice) => {
  const fields = {};
  if (!invoice.clientId) fields.clientId = "Select a client.";
  if (!invoice.description) fields.description = "Describe the billed service.";
  if (!Number.isFinite(invoice.subtotal) || invoice.subtotal <= 0) {
    fields.subtotal = "Subtotal must be greater than zero.";
  }
  for (const field of ["medicalPremium", "platformFee", "vat"]) {
    if (!Number.isFinite(invoice[field]) || invoice[field] < 0) {
      fields[field] = "Amount cannot be negative.";
    }
  }
  if (invoice.dueAt && Number.isNaN(new Date(invoice.dueAt).getTime())) {
    fields.dueAt = "Provide a valid due date.";
  }
  return fields;
};

export const createInvoice = ({
  invoiceId,
  data,
  createdBy,
  now = new Date().toISOString(),
}) => {
  const fields = validateInvoice(data);
  if (Object.keys(fields).length) {
    throw validationError("Correct the invoice fields.", fields);
  }
  const total = money(
    data.subtotal + data.medicalPremium + data.platformFee + data.vat,
  );
  return {
    invoiceId,
    ...data,
    currency: paymentCurrency(),
    total,
    amountPaid: 0,
    status: "pending",
    gateway: null,
    transactionId: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  };
};

export const createPaymentSession = ({
  sessionId,
  invoice,
  provider,
  clientId,
  now = new Date().toISOString(),
}) => ({
  sessionId,
  invoiceId: invoice.invoiceId,
  clientId,
  provider,
  amount: invoice.total,
  currency: invoice.currency,
  status: "pending",
  environment: "test",
  createdAt: now,
  updatedAt: now,
  completedAt: null,
});

export const settleTestPayment = ({
  invoice,
  session,
  successful,
  transactionId,
  now = new Date().toISOString(),
}) => ({
  invoice: {
    ...invoice,
    status: successful ? "paid" : "failed",
    amountPaid: successful ? invoice.total : 0,
    gateway: session.provider,
    transactionId,
    paidAt: successful ? now : null,
    updatedAt: now,
  },
  session: {
    ...session,
    status: successful ? "paid" : "failed",
    transactionId,
    completedAt: now,
    updatedAt: now,
  },
  transaction: {
    transactionId,
    invoiceId: invoice.invoiceId,
    clientId: invoice.clientId,
    type: "client_payment",
    direction: "credit",
    description: invoice.description,
    amount: invoice.total,
    currency: invoice.currency,
    method: session.provider,
    status: successful ? "successful" : "failed",
    createdAt: now,
  },
});

export const availableBalance = (entries = []) =>
  money(entries.reduce((total, entry) => {
    if (
      !["completed", "pending", "processing", "paid"].includes(entry.status)
    ) return total;
    if (
      entry.type === "earning" &&
      entry.status === "completed" &&
      (entry.paymentStatus !== "paid" || entry.payoutId)
    ) {
      return total + Number(entry.amount || 0);
    }
    if (entry.type === "withdrawal") return total - Number(entry.amount || 0);
    return total;
  }, 0));

export const calculateAssignmentPayoutQuote = ({
  agreement,
  payouts = [],
}) => {
  const caregiverAmount = money(agreement?.pricing?.caregiverEarning || 0);
  const platformAmount = money(agreement?.pricing?.platformRevenue || 0);
  const clientTotal = money(agreement?.pricing?.total || 0);
  const siteRetainedAmount = money(
    Math.max(0, clientTotal - caregiverAmount),
  );
  const paidAmount = money(
    payouts
      .filter((record) => record.status === "paid")
      .reduce((sum, record) => sum + Number(record.amount || 0), 0),
  );
  const processingAmount = money(
    payouts
      .filter((record) => ["pending", "processing"].includes(record.status))
      .reduce((sum, record) => sum + Number(record.amount || 0), 0),
  );
  const payableAmount = money(
    Math.max(0, caregiverAmount - paidAmount - processingAmount),
  );
  const serviceComplete = agreement?.serviceStatus === "completed";
  const clientFullyPaid = agreement?.balanceStatus === "paid";
  const settlementComplete = agreement?.settlementStatus === "completed";
  const ready =
    Boolean(agreement?.assignmentId && agreement?.caregiverId) &&
    serviceComplete &&
    clientFullyPaid &&
    settlementComplete &&
    payableAmount > 0;

  let blockedReason = "";
  if (!agreement?.caregiverId || !agreement?.assignmentId) {
    blockedReason = "Assign a caregiver before creating a payout.";
  } else if (!serviceComplete) {
    blockedReason = "Complete the care service before paying the caregiver.";
  } else if (!clientFullyPaid) {
    blockedReason = "The client must pay the final balance first.";
  } else if (!settlementComplete) {
    blockedReason = "The billing settlement has not been generated yet.";
  } else if (payableAmount <= 0) {
    blockedReason = "This caregiver payment has already been settled.";
  }

  return {
    agreementId: agreement?.agreementId || null,
    assignmentId: agreement?.assignmentId || null,
    carePlanId: agreement?.carePlanId || null,
    caregiverId: agreement?.caregiverId || null,
    caregiverName: agreement?.caregiverName || "",
    clientId: agreement?.clientId || null,
    clientName: agreement?.clientName || "",
    careType: agreement?.careType || "",
    currency: agreement?.pricing?.currency || "BDT",
    clientTotal,
    caregiverSharePercent:
      Number(agreement?.pricing?.caregiverSharePercent) || 0,
    caregiverAmount,
    platformAmount,
    siteRetainedAmount,
    paidAmount,
    processingAmount,
    payableAmount,
    ready,
    blockedReason,
  };
};

export const createWithdrawal = ({
  payoutId,
  caregiverId,
  caregiverName,
  amount,
  method,
  available,
  now = new Date().toISOString(),
}) => {
  const normalized = money(amount);
  if (!Number.isFinite(normalized) || normalized < 500) {
    throw validationError("Correct the withdrawal amount.", {
      amount: `The minimum withdrawal is ${paymentCurrency()} 500.`,
    });
  }
  if (normalized > available) {
    throw validationError("Correct the withdrawal amount.", {
      amount: "The withdrawal exceeds the available balance.",
    });
  }
  return {
    payoutId,
    caregiverId,
    caregiverName: text(caregiverName, 120),
    amount: normalized,
    currency: paymentCurrency(),
    method: text(method, 40) || "bkash",
    status: "pending",
    requestedAt: now,
    processedAt: null,
    updatedAt: now,
  };
};

export const createEarning = ({
  ledgerId,
  caregiverId,
  caregiverName,
  amount,
  description,
  visitId = null,
  assignmentId = null,
  clientId = null,
  clientName = "",
  paymentMethod = null,
  paymentReference = null,
  paymentStatus = null,
  createdBy,
  now = new Date().toISOString(),
}) => {
  const normalized = money(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw validationError("Correct the earning amount.", {
      amount: "The earning amount must be greater than zero.",
    });
  }
  return {
    ledgerId,
    caregiverId: text(caregiverId, 128),
    caregiverName: text(caregiverName, 120),
    visitId: text(visitId, 128) || null,
    assignmentId: text(assignmentId, 128) || null,
    clientId: text(clientId, 128) || null,
    clientName: text(clientName, 120),
    type: "earning",
    description: text(description, 240) || "Care service earning",
    amount: normalized,
    currency: paymentCurrency(),
    status: "completed",
    paymentMethod: text(paymentMethod, 40) || null,
    paymentReference: text(paymentReference, 120) || null,
    paymentStatus: paymentStatus === "paid" ? "paid" : null,
    paidAt: paymentStatus === "paid" ? now : null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
};
