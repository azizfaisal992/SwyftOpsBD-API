import { money, createEarning } from "../paymentModel.js";

export const caregiverAdvanceAmount = (agreement) => money(
  Number(agreement?.pricing?.caregiverEarning || 0) * 0.35,
);

export const queueCaregiverAcceptanceAdvance = async ({
  db,
  batch,
  assignment,
  now = new Date().toISOString(),
}) => {
  if (assignment.status !== "confirmed") return [];

  const agreements = await db.collection("billingAgreements")
    .where("carePlanId", "==", assignment.carePlanId)
    .limit(5)
    .get();
  const released = [];

  for (const document of agreements.docs) {
    const agreement = document.data();
    if (
      agreement.depositStatus !== "paid" ||
      agreement.caregiverAdvanceStatus === "released"
    ) continue;

    const amount = caregiverAdvanceAmount(agreement);
    if (amount <= 0) continue;
    const ledgerId = `${agreement.agreementId}-acceptance-advance`;
    const ledgerReference = db.collection("caregiverLedger").doc(ledgerId);
    const ledgerSnapshot = await ledgerReference.get();

    if (!ledgerSnapshot.exists) {
      batch.set(ledgerReference, createEarning({
        ledgerId,
        caregiverId: assignment.caregiverId,
        caregiverName:
          assignment.caregiver?.fullName || agreement.caregiverName || "",
        amount,
        description: `${agreement.careType} — 35% caregiver acceptance advance`,
        assignmentId: assignment.assignmentId,
        clientId: agreement.clientId,
        clientName: agreement.clientName,
        createdBy: "system",
        now,
      }));
    }

    batch.set(document.ref, {
      caregiverId: assignment.caregiverId,
      caregiverName:
        assignment.caregiver?.fullName || agreement.caregiverName || "",
      caregiverAdvanceStatus: "released",
      caregiverAdvanceAmount: amount,
      caregiverAdvanceReleasedAt: now,
      updatedAt: now,
    }, { merge: true });
    released.push({ agreementId: agreement.agreementId, ledgerId, amount });
  }
  return released;
};
