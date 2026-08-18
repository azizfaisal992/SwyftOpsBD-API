import { Router } from "express";
import {
  conflict,
  notFound,
  validationError,
} from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";
import {
  calculateAssignmentPayoutQuote,
  createInvoice,
  PAYOUT_STATUSES,
  sanitizeInvoice,
} from "../paymentModel.js";

const router = Router();
router.use(authenticate, requireAdmin);

const allRecords = async (collection) => {
  const snapshot = await db.collection(collection).limit(500).get();
  return snapshot.docs
    .map((document) => document.data())
    .sort((a, b) =>
      String(b.updatedAt || b.createdAt || b.requestedAt)
        .localeCompare(String(a.updatedAt || a.createdAt || a.requestedAt)));
};

const userPhotoMap = async (userIds) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const snapshots = await db.getAll(
    ...ids.map((userId) => db.collection("users").doc(userId)),
  );
  return new Map(
    snapshots.map((snapshot) => [
      snapshot.id,
      snapshot.exists ? String(snapshot.data().photoURL || "") : "",
    ]),
  );
};

const monthKey = (value) => {
  const date = new Date(
    value && typeof value.toDate === "function" ? value.toDate() : value,
  );
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const lastTwelveMonths = (now = new Date()) =>
  Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (11 - index),
      1,
    ));
    return {
      month: monthKey(date),
      label: date.toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
      clientBilling: 0,
      caregiverPayout: 0,
      platformMargin: 0,
    };
  });

const monthlyReconciliation = ({
  transactions,
  payouts,
  caregiverLedger,
  platformRevenue,
}) => {
  const months = lastTwelveMonths();
  const byMonth = new Map(months.map((item) => [item.month, item]));
  const add = (records, field, predicate, dateOf) => {
    records.filter(predicate).forEach((record) => {
      const bucket = byMonth.get(monthKey(dateOf(record)));
      if (bucket) bucket[field] += Number(record.amount || 0);
    });
  };
  add(
    transactions,
    "clientBilling",
    (record) => record.status === "successful",
    (record) => record.completedAt || record.createdAt,
  );
  add(
    payouts,
    "caregiverPayout",
    (record) => record.status === "paid",
    (record) => record.paidAt || record.updatedAt || record.requestedAt,
  );
  add(
    caregiverLedger,
    "caregiverPayout",
    (record) => record.paymentStatus === "paid" && !record.payoutId,
    (record) => record.paidAt || record.updatedAt || record.createdAt,
  );
  add(
    platformRevenue,
    "platformMargin",
    (record) => record.status === "realized",
    (record) => record.realizedAt || record.createdAt,
  );
  return months;
};

const sumAmounts = (records, predicate) => records
  .filter(predicate)
  .reduce((sum, item) => sum + Number(item.amount || 0), 0);

const accruedPlatformRevenue = (agreements) => agreements.reduce(
  (sum, agreement) => {
    const pricing = agreement.pricing || {};
    const totalPlatformRevenue = Number(pricing.platformRevenue || 0);
    const depositPercent = Number(pricing.depositPercent || 35) / 100;
    const balancePercent = Number(pricing.balancePercent || 65) / 100;
    const depositShare = agreement.depositStatus === "paid"
      ? totalPlatformRevenue * depositPercent
      : 0;
    const balanceShare = agreement.balanceStatus === "paid"
      ? totalPlatformRevenue * balancePercent
      : 0;
    return sum + depositShare + balanceShare;
  },
  0,
);

router.get("/overview", async (_request, response, next) => {
  try {
    const [
      invoices,
      transactions,
      payouts,
      agreements,
      platformRevenue,
      caregiverLedger,
    ] = await Promise.all([
      allRecords("invoices"),
      allRecords("transactions"),
      allRecords("payouts"),
      allRecords("billingAgreements"),
      allRecords("platformRevenue"),
      allRecords("caregiverLedger"),
    ]);
    const grossBilling = transactions
      .filter((item) => item.status === "successful")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const paidPayouts = sumAmounts(
      payouts,
      (item) => item.status === "paid",
    );
    const directlyPaidEarnings = sumAmounts(
      caregiverLedger,
      (item) => item.paymentStatus === "paid" && !item.payoutId,
    );
    const caregiverPayouts = paidPayouts + directlyPaidEarnings;
    const unpaidCaregiverEarnings = sumAmounts(
      caregiverLedger,
      (item) =>
        item.type === "earning" &&
        item.status === "completed" &&
        item.paymentStatus !== "paid",
    );
    const realizedPlatformRevenue = accruedPlatformRevenue(agreements);
    const earnedCaregiverLiability = sumAmounts(
      caregiverLedger,
      (item) => item.type === "earning" && item.status === "completed",
    );
    const clientPhotos = await userPhotoMap([
      ...invoices.map((invoice) => invoice.clientId),
      ...transactions.map((transaction) => transaction.clientId),
    ]);
    return response.json({
      data: {
        currency: String(process.env.PAYMENT_CURRENCY || "BDT")
          .trim().toUpperCase(),
        grossBilling,
        caregiverPayouts,
        platformNetRevenue: realizedPlatformRevenue,
        caregiverLiability: Math.max(
          0,
          earnedCaregiverLiability - caregiverPayouts,
        ),
        pendingPayouts: unpaidCaregiverEarnings,
        pendingPayoutCount: caregiverLedger.filter((item) =>
          item.type === "earning" &&
          item.status === "completed" &&
          item.paymentStatus !== "paid").length,
        invoices: invoices.map((invoice) => ({
          ...invoice,
          clientPhotoURL: clientPhotos.get(invoice.clientId) || "",
        })),
        transactions: transactions.map((transaction) => ({
          ...transaction,
          clientPhotoURL: clientPhotos.get(transaction.clientId) || "",
        })),
        payouts,
        agreements,
        platformRevenue,
        caregiverLedger,
        monthlyReconciliation: monthlyReconciliation({
          transactions,
          payouts,
          caregiverLedger,
          platformRevenue,
        }),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/invoices", async (_request, response, next) => {
  try {
    return response.json({ data: await allRecords("invoices") });
  } catch (error) {
    return next(error);
  }
});

router.post("/invoices", async (request, response, next) => {
  try {
    const data = sanitizeInvoice(request.body);
    const clientSnapshot = await db.collection("clientOnboarding")
      .doc(data.clientId)
      .get();
    if (!clientSnapshot.exists) return next(notFound("Client not found."));
    data.clientName =
      data.clientName || clientSnapshot.data().profile?.fullName || "";
    const invoiceReference = db.collection("invoices").doc();
    const invoice = createInvoice({
      invoiceId: invoiceReference.id,
      data,
      createdBy: request.user.uid,
    });
    await invoiceReference.set(invoice);
    return response.status(201).json({ data: invoice });
  } catch (error) {
    return next(error);
  }
});

router.get("/payouts", async (_request, response, next) => {
  try {
    return response.json({ data: await allRecords("payouts") });
  } catch (error) {
    return next(error);
  }
});

const payoutQuoteForAgreement = async (agreement) => {
  const snapshot = await db.collection("payouts")
    .where("agreementId", "==", agreement.agreementId)
    .limit(20)
    .get();
  return calculateAssignmentPayoutQuote({
    agreement,
    payouts: snapshot.docs.map((document) => document.data()),
  });
};

router.get("/assignment-payout-quotes", async (_request, response, next) => {
  try {
    const [agreements, payouts] = await Promise.all([
      allRecords("billingAgreements"),
      allRecords("payouts"),
    ]);
    const quotes = agreements
      .filter((agreement) =>
        agreement.assignmentId && agreement.caregiverId)
      .map((agreement) =>
        calculateAssignmentPayoutQuote({
          agreement,
          payouts: payouts.filter(
            (payout) => payout.agreementId === agreement.agreementId,
          ),
        }));
    return response.json({ data: quotes });
  } catch (error) {
    return next(error);
  }
});

router.post("/assignment-payouts", async (request, response, next) => {
  try {
    const assignmentId = String(request.body.assignmentId || "").trim();
    if (!assignmentId) {
      return next(validationError("Select a caregiver assignment.", {
        assignmentId: "Choose the caregiver and client assignment.",
      }));
    }
    const agreements = await db.collection("billingAgreements")
      .where("assignmentId", "==", assignmentId)
      .limit(5)
      .get();
    if (agreements.empty) {
      return next(notFound("No billing agreement exists for this assignment."));
    }
    const agreement = agreements.docs[0].data();
    const quote = await payoutQuoteForAgreement(agreement);
    if (!quote.ready) {
      return next(conflict(
        quote.blockedReason || "This caregiver payout is not ready.",
      ));
    }
    const ledgerReference = db.collection("caregiverLedger")
      .doc(agreement.agreementId);
    const ledgerSnapshot = await ledgerReference.get();
    if (!ledgerSnapshot.exists) {
      return next(conflict(
        "The caregiver earning ledger has not been generated yet.",
      ));
    }
    const paymentMethod = String(request.body.paymentMethod || "manual");
    if (!["manual", "bkash", "bank_transfer", "cash"].includes(paymentMethod)) {
      return next(validationError("Select a valid payment method.", {
        paymentMethod: "Use manual, bKash, bank transfer or cash.",
      }));
    }
    const paymentReference = String(request.body.paymentReference || "").trim();
    if (paymentReference) {
      const duplicate = await db.collection("payouts")
        .where("paymentReference", "==", paymentReference)
        .limit(1)
        .get();
      if (!duplicate.empty) {
        return next(validationError("This payment reference already exists.", {
          paymentReference: "Enter a unique transaction reference.",
        }));
      }
    }
    const payoutReference = db.collection("payouts")
      .doc(`assignment_${agreement.agreementId}`);
    const existing = await payoutReference.get();
    if (existing.exists) {
      return next(conflict("This assignment payout has already been recorded."));
    }
    const now = new Date().toISOString();
    const payout = {
      payoutId: payoutReference.id,
      agreementId: agreement.agreementId,
      assignmentId,
      carePlanId: agreement.carePlanId,
      caregiverId: agreement.caregiverId,
      caregiverName: agreement.caregiverName,
      clientId: agreement.clientId,
      clientName: agreement.clientName,
      careType: agreement.careType,
      type: "withdrawal",
      source: "admin_assignment_payout",
      description:
        `${agreement.careType} payment for ${agreement.clientName}`,
      amount: quote.payableAmount,
      caregiverSharePercent: quote.caregiverSharePercent,
      platformAmount: quote.platformAmount,
      siteRetainedAmount: quote.siteRetainedAmount,
      clientTotal: quote.clientTotal,
      currency: quote.currency,
      method: paymentMethod,
      paymentReference: paymentReference || null,
      status: "paid",
      requestedAt: now,
      processedAt: now,
      processedBy: request.user.uid,
      updatedAt: now,
    };
    const batch = db.batch();
    batch.set(payoutReference, payout);
    batch.set(ledgerReference, {
      paymentStatus: "paid",
      payoutId: payout.payoutId,
      paidAt: now,
      updatedAt: now,
    }, { merge: true });
    batch.set(agreements.docs[0].ref, {
      payoutStatus: "paid",
      payoutId: payout.payoutId,
      payoutPaidAt: now,
      updatedAt: now,
    }, { merge: true });
    await batch.commit();
    return response.status(201).json({ data: { payout, quote } });
  } catch (error) {
    return next(error);
  }
});

router.patch("/payouts/:payoutId", async (request, response, next) => {
  try {
    const status = String(request.body.status || "");
    if (!PAYOUT_STATUSES.includes(status)) {
      return next(validationError("Select a valid payout status.", {
        status: "Use pending, processing, paid, failed or cancelled.",
      }));
    }
    const reference = db.collection("payouts").doc(request.params.payoutId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return next(notFound("Payout not found."));
    const now = new Date().toISOString();
    const payout = {
      ...snapshot.data(),
      status,
      processedAt: ["paid", "failed", "cancelled"].includes(status)
        ? now
        : null,
      processedBy: request.user.uid,
      updatedAt: now,
    };
    await reference.set(payout);
    return response.json({ data: payout });
  } catch (error) {
    return next(error);
  }
});

export default router;
