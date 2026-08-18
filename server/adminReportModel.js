const asDate = (value) => {
  const resolved = value && typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);
  return Number.isNaN(resolved.getTime()) ? null : resolved;
};

const number = (value) => {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : 0;
};

const recordDate = (record, fields) => {
  for (const field of fields) {
    const value = asDate(record?.[field]);
    if (value) return value;
  }
  return null;
};

const inside = (date, from, to) =>
  date && date.getTime() >= from.getTime() && date.getTime() <= to.getTime();

const percent = (value, total) =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

const careTypeOf = (record) =>
  String(
    record?.careType ||
    record?.serviceType ||
    record?.serviceDescription ||
    record?.description ||
    "Other",
  ).trim() || "Other";

const resolveRange = (range, now) => {
  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(to);
  if (range === "90d") from.setUTCDate(from.getUTCDate() - 89);
  else if (range === "year") {
    from.setUTCMonth(0, 1);
    from.setUTCHours(0, 0, 0, 0);
  } else from.setUTCDate(from.getUTCDate() - 29);
  return {
    key: ["30d", "90d", "year"].includes(range) ? range : "30d",
    from,
    to,
  };
};

const createBuckets = (from, to, count = 6) => {
  const duration = to.getTime() - from.getTime() + 1;
  const width = duration / count;
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(from.getTime() + width * index);
    const end = index === count - 1
      ? new Date(to)
      : new Date(from.getTime() + width * (index + 1) - 1);
    return {
      start,
      end,
      label: start.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      }),
      revenue: 0,
      payout: 0,
      visits: 0,
      incidents: 0,
    };
  });
};

const bucketFor = (buckets, date) =>
  buckets.find((bucket) => inside(date, bucket.start, bucket.end));

const compactBucket = ({ label, revenue, payout, visits, incidents }) => ({
  label,
  revenue,
  payout,
  visits,
  incidents,
});

export const buildAdminReport = ({
  caregiverLedger = [],
  caregivers = [],
  careRequests = [],
  clients = [],
  incidents = [],
  payouts = [],
  platformRevenue = [],
  transactions = [],
  visits = [],
  range = "30d",
  now = new Date(),
} = {}) => {
  const period = resolveRange(range, now);
  const inPeriod = (record, fields) =>
    inside(recordDate(record, fields), period.from, period.to);

  const periodVisits = visits.filter((record) =>
    inPeriod(record, [
      "clockOutAt",
      "clockInAt",
      "date",
      "updatedAt",
      "createdAt",
    ]));
  const completedVisits = periodVisits.filter(
    (record) => record.status === "completed",
  );
  const successfulTransactions = transactions.filter(
    (record) =>
      record.status === "successful" &&
      inPeriod(record, ["completedAt", "createdAt", "updatedAt"]),
  );
  const paidPayouts = payouts.filter(
    (record) =>
      record.status === "paid" &&
      inPeriod(record, ["paidAt", "processedAt", "updatedAt", "requestedAt"]),
  );
  const directLedgerPayouts = caregiverLedger.filter(
    (record) =>
      record.paymentStatus === "paid" &&
      !record.payoutId &&
      inPeriod(record, ["paidAt", "updatedAt", "createdAt"]),
  );
  const realizedPlatformRevenue = platformRevenue.filter(
    (record) =>
      record.status === "realized" &&
      inPeriod(record, ["realizedAt", "createdAt", "updatedAt"]),
  );
  const periodIncidents = incidents.filter((record) =>
    inPeriod(record, ["createdAt", "reportedAt", "updatedAt"]));
  const periodRequests = careRequests.filter((record) =>
    inPeriod(record, ["createdAt", "submittedAt", "updatedAt"]));

  const grossRevenue = successfulTransactions.reduce(
    (sum, record) => sum + number(record.amount),
    0,
  );
  const caregiverPayouts =
    paidPayouts.reduce((sum, record) => sum + number(record.amount), 0) +
    directLedgerPayouts.reduce(
      (sum, record) => sum + number(record.amount),
      0,
    );
  const platformNetRevenue = realizedPlatformRevenue.reduce(
    (sum, record) => sum + number(record.amount),
    0,
  );
  const careHours = completedVisits.reduce(
    (sum, record) => sum + number(record.durationSeconds) / 3600,
    0,
  );

  const buckets = createBuckets(period.from, period.to);
  successfulTransactions.forEach((record) => {
    const bucket = bucketFor(
      buckets,
      recordDate(record, ["completedAt", "createdAt", "updatedAt"]),
    );
    if (bucket) bucket.revenue += number(record.amount);
  });
  [...paidPayouts, ...directLedgerPayouts].forEach((record) => {
    const bucket = bucketFor(
      buckets,
      recordDate(record, [
        "paidAt",
        "processedAt",
        "updatedAt",
        "requestedAt",
        "createdAt",
      ]),
    );
    if (bucket) bucket.payout += number(record.amount);
  });
  completedVisits.forEach((record) => {
    const bucket = bucketFor(
      buckets,
      recordDate(record, ["clockOutAt", "date", "updatedAt"]),
    );
    if (bucket) bucket.visits += 1;
  });
  periodIncidents.forEach((record) => {
    const bucket = bucketFor(
      buckets,
      recordDate(record, ["createdAt", "reportedAt", "updatedAt"]),
    );
    if (bucket) bucket.incidents += 1;
  });

  const services = new Map();
  const service = (name) => {
    const key = careTypeOf({ careType: name });
    if (!services.has(key)) {
      services.set(key, {
        service: key,
        visits: 0,
        completedVisits: 0,
        careHours: 0,
        revenue: 0,
      });
    }
    return services.get(key);
  };
  periodVisits.forEach((record) => {
    const item = service(careTypeOf(record));
    item.visits += 1;
    if (record.status === "completed") item.completedVisits += 1;
    item.careHours += number(record.durationSeconds) / 3600;
  });
  successfulTransactions.forEach((record) => {
    service(careTypeOf(record)).revenue += number(record.amount);
  });
  const servicePerformance = [...services.values()]
    .map((item) => ({
      ...item,
      careHours: Math.round(item.careHours * 10) / 10,
      completionRate: percent(item.completedVisits, item.visits),
    }))
    .sort((left, right) => right.visits - left.visits);
  const visitTotal = servicePerformance.reduce(
    (sum, item) => sum + item.visits,
    0,
  );
  const serviceMix = servicePerformance.map((item) => ({
    service: item.service,
    visits: item.visits,
    percentage: percent(item.visits, visitTotal),
  }));

  const taskTotals = completedVisits.reduce(
    (totals, record) => ({
      assigned: totals.assigned + (Array.isArray(record.tasks)
        ? record.tasks.length
        : 0),
      completed: totals.completed + (Array.isArray(record.completedTasks)
        ? record.completedTasks.length
        : 0),
    }),
    { assigned: 0, completed: 0 },
  );
  const geofenced = periodVisits.filter(
    (record) => typeof record.withinGeofence === "boolean",
  );
  const resolvedIncidents = periodIncidents.filter((record) =>
    ["resolved", "closed"].includes(record.status));

  return {
    period: {
      key: period.key,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    summary: {
      grossRevenue,
      caregiverPayouts,
      platformNetRevenue,
      completedVisits: completedVisits.length,
      totalVisits: periodVisits.length,
      careHours: Math.round(careHours * 10) / 10,
      incidents: periodIncidents.length,
      incidentRate: percent(periodIncidents.length, periodVisits.length),
      activeClients: clients.filter(
        (record) =>
          record.verificationStatus === "approved" &&
          record.accountStatus !== "suspended",
      ).length,
      activeCaregivers: caregivers.filter(
        (record) =>
          record.verificationStatus === "approved" &&
          record.accountStatus !== "suspended",
      ).length,
      openRequests: careRequests.filter((record) => record.status === "open")
        .length,
      requestsCreated: periodRequests.length,
    },
    quality: {
      visitCompletion: percent(completedVisits.length, periodVisits.length),
      taskCompletion: percent(taskTotals.completed, taskTotals.assigned),
      geofenceCompliance: percent(
        geofenced.filter((record) => record.withinGeofence).length,
        geofenced.length,
      ),
      incidentResolution: percent(
        resolvedIncidents.length,
        periodIncidents.length,
      ),
    },
    trends: buckets.map(compactBucket),
    serviceMix,
    servicePerformance,
    generatedAt: new Date(now).toISOString(),
  };
};

