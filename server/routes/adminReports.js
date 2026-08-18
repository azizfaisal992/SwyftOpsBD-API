import { Router } from "express";
import { buildAdminReport } from "../adminReportModel.js";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";

const router = Router();
router.use(authenticate, requireAdmin);

const records = async (collection, limit = 500) => {
  const snapshot = await db.collection(collection).limit(limit).get();
  return snapshot.docs.map((document) => ({
    ...document.data(),
    id: document.id,
  }));
};

router.get("/overview", async (request, response, next) => {
  try {
    const [
      caregiverLedger,
      caregivers,
      careRequests,
      clients,
      incidents,
      payouts,
      platformRevenue,
      transactions,
      visits,
    ] = await Promise.all([
      records("caregiverLedger"),
      records("caregiverOnboarding"),
      records("careRequests"),
      records("clientOnboarding"),
      records("incidents"),
      records("payouts"),
      records("platformRevenue"),
      records("transactions"),
      records("visits"),
    ]);
    return response.json({
      data: buildAdminReport({
        caregiverLedger,
        caregivers,
        careRequests,
        clients,
        incidents,
        payouts,
        platformRevenue,
        transactions,
        visits,
        range: String(request.query.range || "30d"),
      }),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

