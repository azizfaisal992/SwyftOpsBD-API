import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import adminRoutes from "./routes/admin.js";
import onboardingRoutes from "./routes/onboarding.js";

const app = express();
const port = Number(process.env.API_PORT || 4000);
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("This website origin is not allowed by the API."));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "swiftopsbd-api" });
});
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/admin", adminRoutes);

app.use((error, _request, response, _next) => {
  void _next;
  if (error instanceof multer.MulterError) {
    return response.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Files must be 5MB or smaller." : error.message });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return response.status(status).json({ error: status >= 500 ? "The server could not complete this request." : error.message });
});

app.listen(port, () => {
  console.log(`SwiftOpsBD API listening on http://localhost:${port}`);
});
