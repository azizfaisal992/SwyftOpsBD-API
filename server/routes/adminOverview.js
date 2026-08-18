import { Router } from "express";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";

const router = Router();
router.use(authenticate, requireAdmin);

const dhakaDate = (value = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const queryCount = async (query) => {
  const snapshot = await query.count().get();
  return snapshot.data().count;
};

const activeApprovedCaregiverCount = async () => {
  const snapshot = await db.collection("caregiverOnboarding")
    .where("verificationStatus", "==", "approved")
    .get();
  return snapshot.docs.filter(
    (document) => document.data().accountStatus !== "suspended",
  ).length;
};

const collectionRecords = async (collection, limit = 500) => {
  const snapshot = await db.collection(collection).limit(limit).get();
  return snapshot.docs.map((document) => ({
    ...document.data(),
    id: document.id,
  }));
};

router.get("/overview", async (_request, response, next) => {
  try {
    const today = dhakaDate();
    const [
      activeClients,
      activeCaregivers,
      visitsToday,
      liveVisitsNow,
      pendingCaregiverVerifications,
      pendingClientVerifications,
      pendingRequests,
      liveVisitSnapshot,
      transactions,
      caregiverLedger,
      payouts,
    ] = await Promise.all([
      queryCount(
        db.collection("clientOnboarding")
          .where("verificationStatus", "==", "approved"),
      ),
      activeApprovedCaregiverCount(),
      queryCount(db.collection("visits").where("date", "==", today)),
      queryCount(db.collection("visits").where("status", "==", "active")),
      queryCount(
        db.collection("caregiverOnboarding")
          .where("verificationStatus", "==", "under_review"),
      ),
      queryCount(
        db.collection("clientOnboarding")
          .where("verificationStatus", "==", "under_review"),
      ),
      queryCount(db.collection("careRequests").where("status", "==", "open")),
      db.collection("visits").where("status", "==", "active").limit(100).get(),
      collectionRecords("transactions"),
      collectionRecords("caregiverLedger"),
      collectionRecords("payouts"),
    ]);

    const todaysRevenue = transactions
      .filter((transaction) =>
        transaction.status === "successful" &&
        dhakaDate(transaction.createdAt) === today)
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const completedEarnings = caregiverLedger
      .filter((entry) =>
        entry.type === "earning" && entry.status === "completed")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const directlyPaidEarnings = caregiverLedger
      .filter((entry) => entry.paymentStatus === "paid" && !entry.payoutId)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const paidPayouts = payouts
      .filter((payout) => payout.status === "paid")
      .reduce((sum, payout) => sum + Number(payout.amount || 0), 0);
    const reservedPayouts = payouts
      .filter((payout) => ["pending", "processing"].includes(payout.status))
      .reduce((sum, payout) => sum + Number(payout.amount || 0), 0);

    return response.json({
      data: {
        date: today,
        totalActiveClients: activeClients,
        activeCaregivers,
        visitsToday,
        liveVisitsNow,
        pendingVerifications:
          pendingCaregiverVerifications + pendingClientVerifications,
        pendingCaregiverVerifications,
        pendingClientVerifications,
        pendingRequests,
        todaysRevenue,
        payoutLiability: Math.max(
          0,
          completedEarnings - directlyPaidEarnings - paidPayouts,
        ),
        reservedPayouts,
        liveVisits: liveVisitSnapshot.docs.map((document) => ({
          ...document.data(),
          visitId: document.data().visitId || document.id,
        })),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
