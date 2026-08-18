const escapePdfText = (value) =>
  String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replace(/[^\x20-\x7E]/g, "?");

const line = (label, value, y, bold = false) =>
  `BT /${bold ? "F2" : "F1"} ${bold ? 12 : 10} Tf 54 ${y} Td (${escapePdfText(label)}: ${escapePdfText(value)}) Tj ET`;

const buildPdf = (commands) => {
  const content = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
};

const money = (value, currency = "BDT") =>
  `${String(currency || "BDT").toUpperCase()} ${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const createPayslipPdf = ({
  record,
  recordType,
  recipientName,
  documentTitle = "Payment Payslip",
  filenamePrefix = "SwiftOpsBD-Payslip",
  identifierLabel = "Payslip ID",
}) => {
  const identifier =
    record.invoiceId || record.transactionId || record.payoutId ||
    record.ledgerId || "unknown";
  const date =
    record.paidAt ||
    record.processedAt ||
    record.createdAt ||
    record.requestedAt ||
    new Date().toISOString();
  const commands = [
    "0.025 0.286 0.678 rg",
    "54 748 487 54 re f",
    "1 1 1 rg",
    "BT /F2 22 Tf 72 770 Td (SwiftOpsBD) Tj ET",
    "0.06 0.11 0.18 rg",
    `BT /F2 18 Tf 54 716 Td (${escapePdfText(documentTitle)}) Tj ET`,
    line(identifierLabel, identifier, 682, true),
    line("Record type", recordType, 656),
    line("Recipient", recipientName || "SwiftOpsBD User", 630),
    line("Description", record.description || "Payment transaction", 604),
    line("Amount", money(record.amount ?? record.total, record.currency), 578, true),
    line("Currency", record.currency || "BDT", 552),
    line("Payment method", record.method || record.gateway || "Internal", 526),
    line("Status", record.status || "completed", 500),
    line("Payment date", new Date(date).toLocaleString("en-BD"), 474),
    line(
      "Gateway reference",
      record.bankTransactionId || record.transactionId || identifier,
      448,
    ),
    "0.8 0.82 0.86 RG 54 416 m 541 416 l S",
    "0.35 0.38 0.45 rg",
    "BT /F1 9 Tf 54 392 Td (This document was generated electronically by SwiftOpsBD.) Tj ET",
    "BT /F1 9 Tf 54 376 Td (Keep this payslip as evidence of the recorded transaction.) Tj ET",
  ];
  return {
    buffer: buildPdf(commands),
    filename: `${filenamePrefix}-${identifier}.pdf`,
  };
};
