import { Router } from "express";
import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  availableBalance,
  completeStagedSettlement,
  createBillingAgreement,
  createPaymentSession,
  createStageInvoice,
  createWithdrawal,
  settleTestPayment,
} from "../paymentModel.js";
import { buildCareRequest } from "../careRequestModel.js";
import { createPayslipPdf } from "../services/payslipService.js";
import {
  assertStripeCheckoutMatches,
  constructStripeEvent,
  createStripeCheckout,
  retrieveStripeCheckout,
  retrieveStripeInvoiceDetails,
} from "../services/stripeService.js";

const router = Router();

const clientOrigin = () =>
  String(process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")[0]
    .trim();

const finalizePaymentSession = async ({
  sessionId,
  successful,
  gatewayDetails = {},
}) => {
  const sessionReference = db.collection("paymentSessions").doc(sessionId);
  const sessionSnapshot = await sessionReference.get();
  if (!sessionSnapshot.exists) throw notFound("Payment session not found.");
  const session = sessionSnapshot.data();
  if (session.status === "paid") {
    const existing = await db.collection("transactions").doc(sessionId).get();
    return {
      session,
      transaction: existing.data() || null,
      idempotent: true,
    };
  }
  if (session.status !== "pending") {
    throw conflict("This payment session is already complete.");
  }
  const invoiceReference = db.collection("invoices").doc(session.invoiceId);
  const invoiceSnapshot = await invoiceReference.get();
  if (!invoiceSnapshot.exists) throw notFound("Invoice not found.");
  // The session ID is the transaction document ID, so concurrent success and
  // IPN callbacks overwrite the same record instead of crediting twice.
  const transactionReference = db.collection("transactions").doc(sessionId);
  const result = settleTestPayment({
    invoice: invoiceSnapshot.data(),
    session,
    successful,
    transactionId: transactionReference.id,
  });
  result.invoice = {
    ...result.invoice,
    ...gatewayDetails,
  };
  result.session = {
    ...result.session,
    ...gatewayDetails,
  };
  result.transaction = {
    ...result.transaction,
    sessionId,
    ...gatewayDetails,
  };
  let agreement = null;
  let settlement = null;
  let careRequest = null;
  let paidPlan = null;
  if (result.invoice.billingAgreementId) {
    const agreementReference = db.collection("billingAgreements")
      .doc(result.invoice.billingAgreementId);
    const agreementSnapshot = await agreementReference.get();
    if (!agreementSnapshot.exists) {
      throw notFound("Billing agreement not found.");
    }
    const current = agreementSnapshot.data();
    const now = result.invoice.updatedAt;
    if (result.invoice.stage === "deposit") {
      agreement = {
        ...current,
        status: result.invoice.status === "paid"
          ? "deposit_paid"
          : "deposit_pending",
        depositStatus: result.invoice.status,
        depositPaidAt: result.invoice.status === "paid" ? now : null,
        updatedAt: now,
      };
    } else {
      agreement = {
        ...current,
        status: result.invoice.status === "paid"
          ? "fully_paid"
          : "balance_due",
        balanceStatus: result.invoice.status,
        balancePaidAt: result.invoice.status === "paid" ? now : null,
        updatedAt: now,
      };
      if (
        result.invoice.status === "paid" &&
        agreement.serviceStatus === "completed" &&
        agreement.settlementStatus !== "completed"
      ) {
        settlement = completeStagedSettlement({
          agreement,
          ledgerId: agreement.agreementId,
          revenueId: agreement.agreementId,
          transactionId: transactionReference.id,
          now,
        });
        agreement = settlement.agreement;
      }
    }
  }
  if (
    successful &&
    result.invoice.stage === "deposit" &&
    result.invoice.status === "paid" &&
    result.invoice.carePlanId
  ) {
    const [planSnapshot, clientSnapshot, requestSnapshot] = await Promise.all([
      db.collection("carePlans").doc(result.invoice.carePlanId).get(),
      db.collection("clientOnboarding").doc(result.invoice.clientId).get(),
      db.collection("careRequests").doc(result.invoice.carePlanId).get(),
    ]);
    if (
      planSnapshot.exists &&
      clientSnapshot.exists &&
      clientSnapshot.data().verificationStatus === "approved"
    ) {
      const plan = planSnapshot.data();
      paidPlan = {
        ...plan,
        paymentStatus: "deposit_paid",
        billingAgreementId: result.invoice.billingAgreementId,
      };
      careRequest = requestSnapshot.exists
        ? requestSnapshot.data()
        : buildCareRequest({
            id: result.invoice.carePlanId,
            plan: paidPlan,
            client: clientSnapshot.data(),
            now: result.invoice.updatedAt,
          });
    }
  }
  const batch = db.batch();
  batch.set(invoiceReference, result.invoice);
  batch.set(sessionReference, result.session);
  batch.set(transactionReference, result.transaction);
  if (agreement) {
    batch.set(
      db.collection("billingAgreements").doc(agreement.agreementId),
      agreement,
    );
    if (settlement) {
      batch.set(
        db.collection("caregiverLedger")
          .doc(settlement.caregiverEntry.ledgerId),
        settlement.caregiverEntry,
      );
      batch.set(
        db.collection("platformRevenue")
          .doc(settlement.platformEntry.revenueId),
        settlement.platformEntry,
      );
    }
  }
  if (result.invoice.carePlanId) {
    batch.set(
      db.collection("carePlans").doc(result.invoice.carePlanId),
      {
        paymentStatus: settlement
          ? "settled"
          : result.invoice.stage === "deposit"
            ? result.invoice.status === "paid"
              ? "deposit_paid"
              : "deposit_pending"
            : result.invoice.status === "paid"
              ? "fully_paid"
              : "balance_due",
        invoiceId: result.invoice.invoiceId,
        updatedAt: result.invoice.updatedAt,
      },
      { merge: true },
    );
  }
  if (careRequest && paidPlan) {
    batch.set(
      db.collection("careRequests").doc(result.invoice.carePlanId),
      careRequest,
      { merge: true },
    );
    batch.set(
      db.collection("carePlans").doc(result.invoice.carePlanId),
      {
        status: "submitted",
        requestId: result.invoice.carePlanId,
        billingAgreementId: paidPlan.billingAgreementId,
        paymentStatus: "deposit_paid",
        submittedAt:
          paidPlan.submittedAt || result.invoice.updatedAt,
        updatedAt: result.invoice.updatedAt,
      },
      { merge: true },
    );
  }
  await batch.commit();
  return { ...result, agreement, settlement, careRequest };
};

const loadGatewaySession = async (sessionId) => {
  const sessionSnapshot = await db.collection("paymentSessions")
    .doc(String(sessionId || ""))
    .get();
  if (!sessionSnapshot.exists) throw notFound("Payment session not found.");
  const session = sessionSnapshot.data();
  const invoiceSnapshot = await db.collection("invoices")
    .doc(session.invoiceId)
    .get();
  if (!invoiceSnapshot.exists) throw notFound("Invoice not found.");
  return { session, invoice: invoiceSnapshot.data() };
};

const reconcileStripePaymentSession = async (session) => {
  if (
    session.status !== "pending" ||
    session.provider !== "stripe" ||
    !session.gatewaySessionId
  ) {
    return session;
  }
  const checkout = await retrieveStripeCheckout(session.gatewaySessionId);
  if (checkout.payment_status !== "paid") return session;
  const invoiceSnapshot = await db.collection("invoices")
    .doc(session.invoiceId)
    .get();
  if (!invoiceSnapshot.exists) throw notFound("Invoice not found.");
  const invoice = invoiceSnapshot.data();
  const gatewayDetails = {
    ...assertStripeCheckoutMatches({ checkout, session, invoice }),
    ...await retrieveStripeInvoiceDetails(checkout),
  };
  const finalized = await finalizePaymentSession({
    sessionId: session.sessionId,
    successful: true,
    gatewayDetails,
  });
  return finalized.session;
};

router.post("/stripe/webhook", async (request, response, next) => {
  try {
    const event = constructStripeEvent({
      payload: request.rawBody,
      signature: request.headers["stripe-signature"],
    });
    if (["invoice.finalized", "invoice.paid"].includes(event.type)) {
      const stripeInvoice = event.data.object;
      const invoiceId = stripeInvoice.metadata?.swiftOpsInvoiceId;
      if (invoiceId) {
        await db.collection("invoices").doc(invoiceId).set({
          stripeInvoiceId: stripeInvoice.id,
          stripeInvoiceNumber: stripeInvoice.number || null,
          stripeInvoiceUrl: stripeInvoice.hosted_invoice_url || null,
          stripeInvoicePdf: stripeInvoice.invoice_pdf || null,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      return response.json({ received: true });
    }
    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      return response.json({ received: true });
    }
    const checkout = event.data.object;
    const localSessionId = checkout.metadata?.localSessionId;
    const { session, invoice } = await loadGatewaySession(localSessionId);
    const gatewayDetails = {
      ...assertStripeCheckoutMatches({ checkout, session, invoice }),
      ...await retrieveStripeInvoiceDetails(checkout),
    };
    await finalizePaymentSession({
      sessionId: localSessionId,
      successful: true,
      gatewayDetails,
    });
    return response.json({ received: true });
  } catch (error) {
    return next(error);
  }
});

router.use(authenticate);

router.get("/sessions/:sessionId", async (request, response, next) => {
  try {
    const sessionReference = db.collection("paymentSessions")
      .doc(request.params.sessionId)
    const snapshot = await sessionReference.get();
    if (
      !snapshot.exists ||
      snapshot.data().clientId !== request.user.uid
    ) {
      return next(notFound("Payment session not found."));
    }
    let session = snapshot.data();
    session = await reconcileStripePaymentSession(session);
    return response.json({
      data: {
        sessionId: session.sessionId,
        invoiceId: session.invoiceId,
        provider: session.provider,
        status: session.status,
        amount: session.amount,
        currency: session.currency,
        completedAt: session.completedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

const ownedRecords = async (collection, field, uid) => {
  const snapshot = await db.collection(collection)
    .where(field, "==", uid)
    .limit(200)
    .get();
  return snapshot.docs
    .map((document) => document.data())
    .sort((a, b) =>
      String(b.updatedAt || b.createdAt || b.requestedAt)
        .localeCompare(String(a.updatedAt || a.createdAt || a.requestedAt)));
};

router.get("/summary", async (request, response, next) => {
  try {
    if (request.user.role === "client") {
      const paymentSessions = await ownedRecords(
        "paymentSessions",
        "clientId",
        request.user.uid,
      );
      await Promise.allSettled(
        paymentSessions
          .filter((session) =>
            session.status === "pending" &&
            session.provider === "stripe" &&
            session.gatewaySessionId)
          .slice(0, 10)
          .map(reconcileStripePaymentSession),
      );
      const [invoices, transactions, agreements] = await Promise.all([
        ownedRecords("invoices", "clientId", request.user.uid),
        ownedRecords("transactions", "clientId", request.user.uid),
        ownedRecords("billingAgreements", "clientId", request.user.uid),
      ]);
      const outstanding = invoices
        .filter((invoice) =>
          ["pending", "failed", "locked"].includes(invoice.status))
        .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
      const paid = transactions
        .filter((item) => item.status === "successful")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return response.json({
        data: {
          role: "client",
          outstanding,
          paid,
          invoices,
          transactions,
          agreements,
        },
      });
    }
    if (request.user.role === "caregiver") {
      const [ledger, payouts, agreements] = await Promise.all([
        ownedRecords("caregiverLedger", "caregiverId", request.user.uid),
        ownedRecords("payouts", "caregiverId", request.user.uid),
        ownedRecords("billingAgreements", "caregiverId", request.user.uid),
      ]);
      const completedEarnings = ledger
        .filter((item) =>
          item.type === "earning" && item.status === "completed")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const weekStartedAt = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const weeklyEarnings = ledger
        .filter((item) =>
          item.type === "earning" &&
          item.status === "completed" &&
          new Date(item.createdAt || item.updatedAt || 0).getTime() >=
            weekStartedAt)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const pendingEarnings = agreements
        .filter((item) => item.settlementStatus !== "completed")
        .reduce(
          (sum, item) =>
            sum + Math.max(
              0,
              Number(item.pricing?.caregiverEarning || 0) -
                Number(
                  item.caregiverAdvanceStatus === "released"
                    ? item.caregiverAdvanceAmount || 0
                    : 0,
                ),
            ),
          0,
        );
      return response.json({
        data: {
          role: "caregiver",
          availableBalance: availableBalance([
            ...ledger,
            ...payouts.map((payout) => ({
              ...payout,
              type: "withdrawal",
            })),
          ]),
          completedEarnings,
          weeklyEarnings,
          pendingEarnings,
          monthlyProjection: pendingEarnings,
          ledger,
          payouts,
          agreements,
        },
      });
    }
    return next(forbidden("Only client and caregiver accounts have wallets."));
  } catch (error) {
    return next(error);
  }
});

router.get("/billing", async (request, response, next) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden("Only clients can access care-plan billing."));
    }
    return response.json({
      data: await ownedRecords(
        "billingAgreements",
        "clientId",
        request.user.uid,
      ),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/care-plans/:carePlanId/billing", async (
  request,
  response,
  next,
) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden("Only clients can create care-plan billing."));
    }
    const planReference = db.collection("carePlans")
      .doc(request.params.carePlanId);
    const planSnapshot = await planReference.get();
    if (
      !planSnapshot.exists ||
      planSnapshot.data().clientId !== request.user.uid
    ) {
      return next(notFound("Care plan not found."));
    }
    const existingSnapshot = await db.collection("billingAgreements")
      .where("carePlanId", "==", request.params.carePlanId)
      .limit(5)
      .get();
    const existing = existingSnapshot.docs
      .map((document) => document.data())
      .find((record) => record.clientId === request.user.uid);
    if (existing) {
      const invoices = await db.collection("invoices")
        .where("billingAgreementId", "==", existing.agreementId)
        .limit(5)
        .get();
      const configuredCurrency = String(
        process.env.PAYMENT_CURRENCY || "BDT",
      ).trim().toUpperCase();
      const canUpdateCurrency =
        existing.depositStatus !== "paid" &&
        existing.pricing?.currency !== configuredCurrency;
      const invoiceRecords = invoices.docs.map((document) => document.data());
      if (canUpdateCurrency) {
        const now = new Date().toISOString();
        const batch = db.batch();
        batch.set(existingSnapshot.docs.find(
          (document) => document.data().clientId === request.user.uid,
        ).ref, {
          pricing: { ...existing.pricing, currency: configuredCurrency },
          updatedAt: now,
        }, { merge: true });
        invoices.docs.forEach((document) => {
          if (["pending", "failed", "locked"].includes(document.data().status)) {
            batch.set(document.ref, {
              currency: configuredCurrency,
              updatedAt: now,
            }, { merge: true });
          }
        });
        await batch.commit();
      }
      return response.json({
        data: {
          agreement: canUpdateCurrency
            ? {
                ...existing,
                pricing: { ...existing.pricing, currency: configuredCurrency },
              }
            : existing,
          invoices: canUpdateCurrency
            ? invoiceRecords.map((invoice) => ({
                ...invoice,
                currency: ["pending", "failed", "locked"].includes(invoice.status)
                  ? configuredCurrency
                  : invoice.currency,
              }))
            : invoiceRecords,
        },
      });
    }
    const clientSnapshot = await db.collection("clientOnboarding")
      .doc(request.user.uid)
      .get();
    // Deterministic IDs make checkout initialization idempotent when React
    // development mode starts the same request more than once.
    const agreementReference = db.collection("billingAgreements")
      .doc(request.params.carePlanId);
    const agreement = createBillingAgreement({
      agreementId: agreementReference.id,
      plan: planSnapshot.data(),
      clientName:
        clientSnapshot.data()?.profile?.fullName ||
        request.user.name ||
        request.user.email,
    });
    const depositReference = db.collection("invoices")
      .doc(`${request.params.carePlanId}-deposit`);
    const balanceReference = db.collection("invoices")
      .doc(`${request.params.carePlanId}-balance`);
    agreement.depositInvoiceId = depositReference.id;
    agreement.balanceInvoiceId = balanceReference.id;
    const depositInvoice = createStageInvoice({
      invoiceId: depositReference.id,
      agreement,
      stage: "deposit",
      createdBy: request.user.uid,
    });
    const balanceInvoice = createStageInvoice({
      invoiceId: balanceReference.id,
      agreement,
      stage: "balance",
      createdBy: request.user.uid,
    });
    const batch = db.batch();
    batch.set(agreementReference, agreement);
    batch.set(depositReference, depositInvoice);
    batch.set(balanceReference, balanceInvoice);
    batch.set(planReference, {
      billingAgreementId: agreement.agreementId,
      paymentStatus: "deposit_pending",
      pricing: agreement.pricing,
      updatedAt: agreement.updatedAt,
    }, { merge: true });
    await batch.commit();
    return response.status(201).json({
      data: {
        agreement,
        invoices: [depositInvoice, balanceInvoice],
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/invoices", async (request, response, next) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden("Only clients can access client invoices."));
    }
    return response.json({
      data: await ownedRecords("invoices", "clientId", request.user.uid),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/transactions", async (request, response, next) => {
  try {
    if (request.user.role === "client") {
      return response.json({
        data: await ownedRecords(
          "transactions",
          "clientId",
          request.user.uid,
        ),
      });
    }
    if (request.user.role === "caregiver") {
      return response.json({
        data: await ownedRecords(
          "caregiverLedger",
          "caregiverId",
          request.user.uid,
        ),
      });
    }
    return next(forbidden("This account does not have payment transactions."));
  } catch (error) {
    return next(error);
  }
});

router.get("/payslips/:recordType/:recordId", async (
  request,
  response,
  next,
) => {
  try {
    const collections = {
      transaction: "transactions",
      earning: "caregiverLedger",
      payout: "payouts",
    };
    const collection = collections[request.params.recordType];
    if (!collection) return next(notFound("Payslip record not found."));
    const snapshot = await db.collection(collection)
      .doc(request.params.recordId)
      .get();
    if (!snapshot.exists) return next(notFound("Payslip record not found."));
    const record = snapshot.data();
    const ownerId =
      request.params.recordType === "transaction"
        ? record.clientId
        : record.caregiverId;
    if (request.user.admin !== true && ownerId !== request.user.uid) {
      return next(forbidden("You cannot download this payslip."));
    }
    const complete =
      record.status === "successful" ||
      record.status === "completed" ||
      record.status === "paid";
    if (!complete) {
      return next(conflict(
        "A payslip is available after the transaction is completed.",
      ));
    }
    const { buffer, filename } = createPayslipPdf({
      record,
      recordType: request.params.recordType,
      recipientName:
        record.clientName ||
        record.caregiverName ||
        request.user.name ||
        request.user.email,
    });
    response.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    });
    return response.send(buffer);
  } catch (error) {
    return next(error);
  }
});

router.get("/invoices/:invoiceId/swiftopsbd-invoice", async (
  request,
  response,
  next,
) => {
  try {
    const snapshot = await db.collection("invoices")
      .doc(request.params.invoiceId)
      .get();
    if (!snapshot.exists) return next(notFound("Invoice not found."));
    const invoice = snapshot.data();
    if (request.user.admin !== true && invoice.clientId !== request.user.uid) {
      return next(forbidden("You cannot download this invoice."));
    }
    const { buffer, filename } = createPayslipPdf({
      record: invoice,
      recordType: "client invoice",
      recipientName: invoice.clientName || request.user.name || request.user.email,
      documentTitle: "SwiftOpsBD Invoice",
      filenamePrefix: "SwiftOpsBD-Invoice",
      identifierLabel: "Invoice ID",
    });
    response.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length,
      "Cache-Control": "private, no-store",
    });
    return response.send(buffer);
  } catch (error) {
    return next(error);
  }
});

router.post("/invoices/:invoiceId/checkout", async (request, response, next) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden("Only clients can pay an invoice."));
    }
    const invoiceReference = db.collection("invoices")
      .doc(request.params.invoiceId);
    const invoiceSnapshot = await invoiceReference.get();
    if (
      !invoiceSnapshot.exists ||
      invoiceSnapshot.data().clientId !== request.user.uid
    ) {
      return next(notFound("Invoice not found."));
    }
    const invoice = invoiceSnapshot.data();
    if (!["pending", "failed"].includes(invoice.status)) {
      return next(conflict("This invoice is not payable."));
    }
    const provider = ["stripe", "bkash"].includes(request.body.provider)
      ? request.body.provider
      : (process.env.PAYMENT_GATEWAY || "stripe");
    const sessionReference = db.collection("paymentSessions").doc();
    const session = createPaymentSession({
      sessionId: sessionReference.id,
      invoice,
      provider,
      clientId: request.user.uid,
    });
    const paymentMode = process.env.PAYMENT_MODE || "test";
    if (provider === "bkash") {
      if (
        process.env.NODE_ENV === "production" ||
        (process.env.BKASH_MODE || "demo") !== "demo"
      ) {
        return next(conflict(
          "The demo bKash form is disabled. Use Stripe Checkout for card payments.",
        ));
      }
      const demoSession = {
        ...session,
        nextAction: "bkash_demo",
      };
      await sessionReference.set(demoSession);
      return response.status(201).json({
        data: {
          ...demoSession,
          message: "Demo bKash checkout created. No wallet will be charged.",
        },
      });
    }
    if (paymentMode === "test") {
      await sessionReference.set(session);
      return response.status(201).json({
        data: {
          ...session,
          nextAction: "simulate",
          message: "Local payment simulation created. No real money was charged.",
        },
      });
    }
    if (provider === "stripe") {
      const clientSnapshot = await db.collection("clientOnboarding")
        .doc(request.user.uid)
        .get();
      const client = clientSnapshot.data() || {};
      const gateway = await createStripeCheckout({
        session,
        invoice,
        customerEmail: client.contact?.email || request.user.email,
        clientOrigin: clientOrigin(),
      });
      const hostedSession = {
        ...session,
        ...gateway,
        nextAction: "redirect",
      };
      await sessionReference.set(hostedSession);
      return response.status(201).json({
        data: {
          ...hostedSession,
          message: "Continue on the secure Stripe test checkout.",
        },
      });
    }
    return next(validationError("Unsupported payment provider."));
  } catch (error) {
    return next(error);
  }
});

router.post("/sessions/:sessionId/simulate", async (request, response, next) => {
  try {
    if (request.user.role !== "client") {
      return next(forbidden("Only clients can complete a checkout."));
    }
    const sessionSnapshot = await db.collection("paymentSessions")
      .doc(request.params.sessionId)
      .get();
    const pendingSession = sessionSnapshot.exists
      ? sessionSnapshot.data()
      : null;
    const demoBkash =
      pendingSession?.provider === "bkash" &&
      (process.env.BKASH_MODE || "demo") === "demo";
    if (
      process.env.NODE_ENV === "production" ||
      ((process.env.PAYMENT_MODE || "test") !== "test" && !demoBkash)
    ) {
      return next(forbidden("Payment simulation is disabled in production."));
    }
    if (
      !sessionSnapshot.exists ||
      sessionSnapshot.data().clientId !== request.user.uid
    ) {
      return next(notFound("Payment session not found."));
    }
    const session = sessionSnapshot.data();
    if (
      session.provider === "bkash" &&
      !/^01\d{9}$/.test(String(request.body.phone || ""))
    ) {
      return next(validationError("Enter a valid bKash account number.", {
        phone: "Use an 11-digit Bangladeshi mobile number.",
      }));
    }
    const result = await finalizePaymentSession({
      sessionId: request.params.sessionId,
      successful: request.body.outcome !== "failed",
      gatewayDetails: {
        gatewayMode: "demo",
        demoPhone: String(request.body.phone || "").slice(-4)
          ? `*******${String(request.body.phone || "").slice(-4)}`
          : null,
      },
    });
    return response.json({ data: result });
  } catch (error) {
    return next(error);
  }
});

router.post("/withdrawals", async (request, response, next) => {
  try {
    if (request.user.role !== "caregiver") {
      return next(forbidden("Only caregivers can request withdrawals."));
    }
    const [ledger, payouts] = await Promise.all([
      ownedRecords("caregiverLedger", "caregiverId", request.user.uid),
      ownedRecords("payouts", "caregiverId", request.user.uid),
    ]);
    const payoutReference = db.collection("payouts").doc();
    const payout = createWithdrawal({
      payoutId: payoutReference.id,
      caregiverId: request.user.uid,
      caregiverName: request.user.name || request.user.email || "",
      amount: request.body.amount,
      method: request.body.method,
      available: availableBalance([
        ...ledger,
        ...payouts.map((record) => ({ ...record, type: "withdrawal" })),
      ]),
    });
    await payoutReference.set(payout);
    return response.status(201).json({ data: payout });
  } catch (error) {
    return next(error);
  }
});

export default router;
