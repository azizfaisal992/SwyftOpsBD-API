import assert from "node:assert/strict";
import test from "node:test";
import {
  availableBalance,
  calculateAssignmentPayoutQuote,
  calculateCarePlanPricing,
  completeStagedSettlement,
  createBillingAgreement,
  createEarning,
  createInvoice,
  createPaymentSession,
  createStageInvoice,
  createWithdrawal,
  sanitizeInvoice,
  settleTestPayment,
} from "./paymentModel.js";

test("creates a BDT invoice with a server-derived total", () => {
  const invoice = createInvoice({
    invoiceId: "inv-1",
    createdBy: "admin-1",
    data: sanitizeInvoice({
      clientId: "client-1",
      description: "Home care",
      subtotal: 1000,
      medicalPremium: 100,
      platformFee: 50,
      vat: 172.5,
    }),
  });
  assert.equal(invoice.total, 1322.5);
  assert.equal(invoice.status, "pending");
  assert.equal(invoice.currency, "BDT");
});

test("prices a monthly care plan into a 35 percent deposit and 65 percent balance", () => {
  const pricing = calculateCarePlanPricing({
    careType: "Senior Care",
    hoursPerWeek: 20,
  });
  assert.equal(pricing.serviceSubtotal, 68000);
  assert.equal(pricing.total, 73000);
  assert.equal(pricing.depositAmount, 25550);
  assert.equal(pricing.balanceAmount, 47450);
  assert.equal(pricing.depositAmount + pricing.balanceAmount, pricing.total);
});

test("prices the complete selected service period using scheduled visits", () => {
  const pricing = calculateCarePlanPricing({
    careType: "Senior Care",
    hoursPerWeek: 21,
    preferredDays: ["Mon", "Wed", "Fri"],
    serviceStartDate: "2026-08-03",
    serviceEndDate: "2026-08-16",
    selectedCaregiver: { rate: 900 },
  });
  assert.equal(pricing.visitCount, 6);
  assert.equal(pricing.totalServiceHours, 42);
  assert.equal(pricing.serviceSubtotal, 37800);
  assert.equal(pricing.billingDays, 14);
});

test("creates locked staged invoices from server pricing", () => {
  const agreement = createBillingAgreement({
    agreementId: "agreement-1",
    plan: {
      carePlanId: "plan-1",
      clientId: "client-1",
      careType: "Senior Care",
      hoursPerWeek: 20,
    },
  });
  const deposit = createStageInvoice({
    invoiceId: "deposit-1",
    agreement,
    stage: "deposit",
    createdBy: "client-1",
  });
  const balance = createStageInvoice({
    invoiceId: "balance-1",
    agreement,
    stage: "balance",
    createdBy: "client-1",
  });
  assert.equal(deposit.status, "pending");
  assert.equal(deposit.total, agreement.pricing.depositAmount);
  assert.equal(balance.status, "locked");
  assert.equal(balance.total, agreement.pricing.balanceAmount);
});

test("settles an 85 percent caregiver share only after service and final payment", () => {
  const agreement = createBillingAgreement({
    agreementId: "agreement-1",
    plan: {
      carePlanId: "plan-1",
      clientId: "client-1",
      careType: "Senior Care",
      hoursPerWeek: 20,
    },
  });
  const result = completeStagedSettlement({
    agreement: {
      ...agreement,
      caregiverId: "caregiver-1",
      caregiverName: "Rahima",
      serviceStatus: "completed",
      balanceStatus: "paid",
    },
    ledgerId: "agreement-1",
    revenueId: "agreement-1",
    transactionId: "transaction-1",
  });
  assert.equal(result.caregiverEntry.amount, 57800);
  assert.equal(result.platformEntry.amount, 12700);
  assert.equal(
    result.caregiverEntry.amount +
      result.platformEntry.amount +
      result.platformEntry.medicalReserve,
    agreement.pricing.total,
  );
});

test("final settlement subtracts an acceptance advance already released", () => {
  const agreement = createBillingAgreement({
    agreementId: "agreement-advance",
    plan: {
      carePlanId: "plan-advance",
      clientId: "client-1",
      careType: "Senior Care",
      hoursPerWeek: 20,
    },
  });
  const advance = Math.round(agreement.pricing.caregiverEarning * 0.35 * 100) / 100;
  const result = completeStagedSettlement({
    agreement: {
      ...agreement,
      caregiverId: "caregiver-1",
      caregiverName: "Rahima",
      caregiverAdvanceStatus: "released",
      caregiverAdvanceAmount: advance,
      serviceStatus: "completed",
      balanceStatus: "paid",
    },
    ledgerId: "agreement-advance-final",
    revenueId: "agreement-advance",
    transactionId: "transaction-advance",
  });
  assert.equal(
    result.caregiverEntry.amount,
    agreement.pricing.caregiverEarning - advance,
  );
  assert.equal(
    advance + result.caregiverEntry.amount,
    agreement.pricing.caregiverEarning,
  );
});

test("settles a test payment atomically into invoice and transaction data", () => {
  const invoice = createInvoice({
    invoiceId: "inv-1",
    createdBy: "admin-1",
    data: sanitizeInvoice({
      clientId: "client-1",
      description: "Home care",
      subtotal: 1000,
    }),
  });
  const session = createPaymentSession({
    sessionId: "session-1",
    invoice,
    provider: "sslcommerz",
    clientId: "client-1",
  });
  const result = settleTestPayment({
    invoice,
    session,
    successful: true,
    transactionId: "txn-1",
  });
  assert.equal(result.invoice.status, "paid");
  assert.equal(result.transaction.amount, 1000);
});

test("calculates caregiver balance after completed earnings and withdrawals", () => {
  assert.equal(availableBalance([
    { type: "earning", amount: 3000, status: "completed" },
    { type: "withdrawal", amount: 1000, status: "paid" },
    { type: "withdrawal", amount: 500, status: "pending" },
  ]), 1500);
});

test("prevents a withdrawal above the available balance", () => {
  assert.throws(
    () => createWithdrawal({
      payoutId: "pay-1",
      caregiverId: "caregiver-1",
      amount: 2000,
      available: 1000,
    }),
    /withdrawal amount/i,
  );
});

test("creates a completed caregiver earning ledger entry", () => {
  const entry = createEarning({
    ledgerId: "ledger-1",
    caregiverId: "caregiver-1",
    caregiverName: "Care Giver",
    amount: 850,
    description: "Completed home visit",
    visitId: "visit-1",
    createdBy: "admin-1",
  });
  assert.equal(entry.type, "earning");
  assert.equal(entry.status, "completed");
  assert.equal(entry.amount, 850);
});

test("records an admin-paid caregiver earning without leaving wallet liability", () => {
  const entry = createEarning({
    ledgerId: "ledger-paid-1",
    caregiverId: "caregiver-1",
    caregiverName: "Care Giver",
    clientId: "client-1",
    clientName: "Client Name",
    assignmentId: "assignment-1",
    amount: 1200,
    description: "Care payment for Client Name",
    paymentMethod: "bkash",
    paymentReference: "BKASH-123",
    paymentStatus: "paid",
    createdBy: "admin-1",
    now: "2026-07-28T10:00:00.000Z",
  });

  assert.equal(entry.paymentStatus, "paid");
  assert.equal(entry.assignmentId, "assignment-1");
  assert.equal(entry.clientName, "Client Name");
  assert.equal(entry.paidAt, "2026-07-28T10:00:00.000Z");
  assert.equal(availableBalance([entry]), 0);
});

test("calculates the remaining caregiver payout from the locked agreement", () => {
  const quote = calculateAssignmentPayoutQuote({
    agreement: {
      agreementId: "agreement-1",
      assignmentId: "assignment-1",
      caregiverId: "caregiver-1",
      caregiverName: "Care Giver",
      clientId: "client-1",
      clientName: "Client Name",
      careType: "Senior Care",
      serviceStatus: "completed",
      balanceStatus: "paid",
      settlementStatus: "completed",
      pricing: {
        currency: "BDT",
        total: 21700,
        caregiverSharePercent: 85,
        caregiverEarning: 15300,
        platformRevenue: 3900,
      },
    },
    payouts: [
      { amount: 3000, status: "paid" },
      { amount: 2000, status: "failed" },
    ],
  });

  assert.equal(quote.caregiverAmount, 15300);
  assert.equal(quote.paidAmount, 3000);
  assert.equal(quote.payableAmount, 12300);
  assert.equal(quote.platformAmount, 3900);
  assert.equal(quote.ready, true);
});

test("blocks caregiver payout until the client final balance is paid", () => {
  const quote = calculateAssignmentPayoutQuote({
    agreement: {
      assignmentId: "assignment-1",
      caregiverId: "caregiver-1",
      serviceStatus: "completed",
      balanceStatus: "pending",
      settlementStatus: "pending",
      pricing: { caregiverEarning: 15300 },
    },
  });

  assert.equal(quote.ready, false);
  assert.match(quote.blockedReason, /final balance/i);
});
