const DEFAULT_CLIENT_ORIGIN = "http://localhost:5173";

const parsePort = (value) => {
  const port = Number(value || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }
  return port;
};

const parseOrigins = (value) => {
  const origins = String(value || DEFAULT_CLIENT_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CLIENT_ORIGIN must contain at least one origin.");
  }

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CLIENT_ORIGIN contains an invalid URL: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`CLIENT_ORIGIN must contain origins only, without paths: ${origin}`);
    }
  }

  return origins;
};

export const loadEnvironment = (source = process.env) => {
  const nodeEnv = source.NODE_ENV || "development";
  const fileStorageProvider = source.FILE_STORAGE_PROVIDER || "local";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }
  if (nodeEnv === "production" && !source.CLIENT_ORIGIN) {
    throw new Error("CLIENT_ORIGIN is required in production.");
  }
  if (nodeEnv === "production" && !source.FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID is required in production.");
  }
  if (!["local", "firebase", "supabase"].includes(fileStorageProvider)) {
    throw new Error(
      "FILE_STORAGE_PROVIDER must be local, firebase, or supabase.",
    );
  }
  if (nodeEnv === "production" && fileStorageProvider === "local") {
    throw new Error(
      "Production cannot use local file storage. Configure Supabase Storage.",
    );
  }
  if (fileStorageProvider === "supabase") {
    if (
      !source.SUPABASE_URL ||
      !(source.SUPABASE_SECRET_KEY || source.SUPABASE_SERVICE_ROLE_KEY)
    ) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SECRET_KEY are required " +
        "for Supabase Storage.",
      );
    }
    let supabaseUrl;
    try {
      supabaseUrl = new URL(source.SUPABASE_URL);
    } catch {
      throw new Error("SUPABASE_URL must be a valid HTTPS URL.");
    }
    if (supabaseUrl.protocol !== "https:") {
      throw new Error("SUPABASE_URL must be a valid HTTPS URL.");
    }
  }

  return Object.freeze({
    nodeEnv,
    port: parsePort(source.API_PORT),
    allowedOrigins: Object.freeze(parseOrigins(source.CLIENT_ORIGIN)),
    firebaseProjectId: source.FIREBASE_PROJECT_ID || "swiftopsbd",
    fileStorageProvider,
    serviceName: "swiftopsbd-api",
    apiVersion: "v1",
  });
};
