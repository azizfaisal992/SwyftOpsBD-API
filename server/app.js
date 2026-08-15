import cors from "cors";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { loadEnvironment } from "./config/environment.js";
import openApiDocument from "./docs/openapi.js";
import { forbidden } from "./errors/ApiError.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { requestId } from "./middleware/requestId.js";
import { requestTiming } from "./middleware/requestTiming.js";
import adminRoutes from "./routes/admin.js";
import adminCareRequestRoutes from "./routes/adminCareRequests.js";
import adminAssignmentRoutes from "./routes/adminAssignments.js";
import adminUserRoutes from "./routes/adminUsers.js";
import carePlanRoutes from "./routes/carePlans.js";
import careRequestRoutes from "./routes/careRequests.js";
import clientOnboardingRoutes from "./routes/clientOnboarding.js";
import onboardingRoutes from "./routes/onboarding.js";
import userRoutes from "./routes/users.js";
import assignmentRoutes from "./routes/assignments.js";
import shiftRoutes from "./routes/shifts.js";
import visitRoutes from "./routes/visits.js";
import mapRoutes from "./routes/maps.js";
import paymentRoutes from "./routes/payments.js";
import adminPaymentRoutes from "./routes/adminPayments.js";
import communicationRoutes from "./routes/communications.js";
import adminCommunicationRoutes from "./routes/adminCommunications.js";
import adminOverviewRoutes from "./routes/adminOverview.js";
import adminReportRoutes from "./routes/adminReports.js";
import incidentRoutes from "./routes/incidents.js";
import adminIncidentRoutes from "./routes/adminIncidents.js";
import medicalDocumentRoutes from "./routes/medicalDocuments.js";
import adminDirectoryRoutes from "./routes/adminDirectory.js";
import directoryRoutes from "./routes/directory.js";

const healthPayload = (environment, request) => ({
  data: {
    status: "ok",
    service: environment.serviceName,
    version: environment.apiVersion,
    environment: environment.nodeEnv,
  },
  meta: {
    requestId: request.id,
    timestamp: new Date().toISOString(),
  },
});

const legacyRoute = (_request, response, next) => {
  response.set("Deprecation", "true");
  response.set("Link", '</api/v1>; rel="successor-version"');
  next();
};

export const createApp = (options = {}) => {
  const environment = options.environment || loadEnvironment();
  const app = express();

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(requestTiming);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || environment.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(forbidden("This website origin is not allowed by the API."));
    },
    credentials: true,
    exposedHeaders: ["x-request-id", "content-disposition"],
  }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
  app.use(express.json({
    limit: "1mb",
    verify(request, _response, buffer) {
      if (request.originalUrl === "/api/v1/payments/stripe/webhook") {
        request.rawBody = Buffer.from(buffer);
      }
    },
  }));

  app.get("/api/v1/health", (request, response) => {
    response.json(healthPayload(environment, request));
  });
  app.get("/api-docs.json", (_request, response) => {
    response.json(openApiDocument);
  });
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "SwiftOpsBD API Documentation",
      swaggerOptions: {
        displayRequestDuration: true,
        filter: true,
        persistAuthorization: true,
        tryItOutEnabled: true,
      },
    }),
  );
  app.use("/api/v1/users", userRoutes);
  app.use("/api/v1/care-plans", carePlanRoutes);
  app.use("/api/v1/care-requests", careRequestRoutes);
  app.use("/api/v1/assignments", assignmentRoutes);
  app.use("/api/v1/visits", visitRoutes);
  app.use("/api/v1/shifts", shiftRoutes);
  app.use("/api/v1/maps", mapRoutes);
  app.use("/api/v1/payments", paymentRoutes);
  app.use("/api/v1/admin/payments", adminPaymentRoutes);
  app.use("/api/v1/admin/dashboard", adminOverviewRoutes);
  app.use("/api/v1/admin/reports", adminReportRoutes);
  app.use("/api/v1/incidents", incidentRoutes);
  app.use("/api/v1/admin/incidents", adminIncidentRoutes);
  app.use("/api/v1/admin/directory", adminDirectoryRoutes);
  app.use("/api/v1/directory", directoryRoutes);
  app.use("/api/v1/medical-documents", medicalDocumentRoutes);
  app.use("/api/v1/communications", communicationRoutes);
  app.use("/api/v1/admin/communications", adminCommunicationRoutes);
  app.use("/api/v1/admin/assignments", adminAssignmentRoutes);
  app.use("/api/v1/admin/care-requests", adminCareRequestRoutes);
  app.use("/api/v1/admin/users", adminUserRoutes);
  app.use("/api/v1/client-onboarding", clientOnboardingRoutes);
  app.use("/api/v1/onboarding", onboardingRoutes);
  app.use("/api/v1/admin", adminRoutes);

  // Temporary compatibility while the frontend migrates to /api/v1.
  app.get("/api/health", legacyRoute, (request, response) => {
    response.json(healthPayload(environment, request));
  });
  app.use("/api/onboarding", legacyRoute, onboardingRoutes);
  app.use("/api/client-onboarding", legacyRoute, clientOnboardingRoutes);
  app.use("/api/admin", legacyRoute, adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
