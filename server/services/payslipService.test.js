import assert from "node:assert/strict";
import test from "node:test";
import { createPayslipPdf } from "./payslipService.js";

test("generates a downloadable PDF payslip", () => {
  const result = createPayslipPdf({
    recordType: "payout",
    recipientName: "Caregiver Example",
    record: {
      payoutId: "payout-1",
      description: "Caregiver withdrawal",
      amount: 5000,
      currency: "BDT",
      method: "bKash",
      status: "paid",
      processedAt: "2026-07-28T10:00:00.000Z",
    },
  });
  assert.equal(result.filename, "SwiftOpsBD-Payslip-payout-1.pdf");
  assert.equal(result.buffer.subarray(0, 8).toString(), "%PDF-1.4");
  assert.ok(result.buffer.length > 500);
});

test("generates a branded SwiftOpsBD client invoice", () => {
  const result = createPayslipPdf({
    recordType: "client invoice",
    recipientName: "Client Example",
    documentTitle: "SwiftOpsBD Invoice",
    filenamePrefix: "SwiftOpsBD-Invoice",
    identifierLabel: "Invoice ID",
    record: {
      invoiceId: "invoice-1",
      description: "35% care-plan booking deposit",
      total: 22750,
      currency: "USD",
      status: "paid",
      createdAt: "2026-08-01T10:00:00.000Z",
    },
  });

  assert.equal(result.filename, "SwiftOpsBD-Invoice-invoice-1.pdf");
  assert.equal(result.buffer.subarray(0, 8).toString(), "%PDF-1.4");
  assert.ok(result.buffer.length > 500);
});
