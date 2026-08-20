import assert from "node:assert/strict";
import test from "node:test";
import { loadEnvironment } from "./environment.js";

test("loads safe local defaults", () => {
  const environment = loadEnvironment({});
  assert.equal(environment.nodeEnv, "development");
  assert.equal(environment.port, 4000);
  assert.deepEqual(environment.allowedOrigins, ["http://localhost:5173"]);
  assert.equal(environment.firebaseProjectId, "swiftopsbd");
  assert.equal(environment.fileStorageProvider, "local");
});

test("parses multiple exact client origins", () => {
  const environment = loadEnvironment({
    CLIENT_ORIGIN: "http://localhost:5173,https://swiftopsbd.vercel.app",
  });
  assert.deepEqual(environment.allowedOrigins, [
    "http://localhost:5173",
    "https://swiftopsbd.vercel.app",
  ]);
});

test("rejects invalid ports and origins", () => {
  assert.throws(() => loadEnvironment({ API_PORT: "70000" }), /API_PORT/);
  assert.throws(
    () => loadEnvironment({ CLIENT_ORIGIN: "https://example.com/path" }),
    /without paths/,
  );
});

test("prefers the hosting platform PORT over the local API_PORT", () => {
  const environment = loadEnvironment({ PORT: "10000", API_PORT: "4000" });
  assert.equal(environment.port, 10000);
});

test("requires explicit production project and origin", () => {
  assert.throws(
    () => loadEnvironment({ NODE_ENV: "production" }),
    /CLIENT_ORIGIN is required/,
  );
  assert.throws(
    () => loadEnvironment({
      NODE_ENV: "production",
      CLIENT_ORIGIN: "https://swiftopsbd.vercel.app",
    }),
    /FIREBASE_PROJECT_ID is required/,
  );
  assert.throws(
    () => loadEnvironment({
      NODE_ENV: "production",
      CLIENT_ORIGIN: "https://swiftopsbd.vercel.app",
      FIREBASE_PROJECT_ID: "swiftopsbd",
    }),
    /Production cannot use local file storage/,
  );
});

test("validates private Supabase storage configuration", () => {
  assert.throws(
    () => loadEnvironment({ FILE_STORAGE_PROVIDER: "supabase" }),
    /SUPABASE_URL/,
  );
  const environment = loadEnvironment({
    FILE_STORAGE_PROVIDER: "supabase",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "server-secret",
  });
  assert.equal(environment.fileStorageProvider, "supabase");
});
