import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

const environment = Object.freeze({
  nodeEnv: "test",
  port: 4000,
  allowedOrigins: Object.freeze(["http://localhost:5173"]),
  firebaseProjectId: "swiftopsbd",
  serviceName: "swiftopsbd-api",
  apiVersion: "v1",
});

const withServer = async (callback) => {
  const server = createApp({ environment }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
};

test("v1 health returns the normalized envelope and request ID", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { "x-request-id": "test-request-123" },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "test-request-123");
    assert.equal(payload.data.status, "ok");
    assert.equal(payload.data.version, "v1");
    assert.equal(payload.meta.requestId, "test-request-123");
    assert.match(payload.meta.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("OpenAPI document exposes the versioned REST endpoints", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api-docs.json`);
    const document = await response.json();

    assert.equal(response.status, 200);
    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.title, "SwiftOpsBD REST API");
    assert.ok(document.paths["/api/v1/health"].get);
    assert.ok(document.paths["/api/v1/onboarding/profile"].put);
    assert.ok(document.paths["/api/v1/payments/stripe/webhook"].post);
    assert.ok(Object.keys(document.paths).length >= 80);
    assert.equal(
      document.components.securitySchemes.firebaseBearer.scheme,
      "bearer",
    );
  });
});

test("Swagger UI is publicly available", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api-docs/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /SwiftOpsBD API Documentation/);
  });
});

test("legacy health remains available with deprecation headers", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("deprecation"), "true");
    assert.match(response.headers.get("link"), /\/api\/v1/);
  });
});

test("allowed CORS origin receives an allow-origin header", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:5173",
    );
  });
});

test("blocked CORS origin returns a normalized 403 instead of 500", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: "https://untrusted.example" },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "FORBIDDEN");
    assert.match(payload.error.requestId, /^req_/);
  });
});

test("unknown API route returns normalized 404", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/missing`);
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.error.code, "NOT_FOUND");
    assert.match(payload.error.message, /GET \/api\/v1\/missing/);
  });
});

test("malformed JSON returns normalized 400", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/onboarding/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "INVALID_JSON");
  });
});

test("protected route without a token returns normalized 401", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/onboarding/me`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
    assert.match(payload.error.message, /Firebase Bearer token/);
  });
});

test("Sprint 1 user bootstrap route is mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/users/bootstrap`, {
      method: "POST",
    });
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});

test("Sprint 1 admin-claims route is mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/admin/users/user-1/claims`,
      { method: "POST" },
    );
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});

test("Sprint 2 client onboarding route is mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/client-onboarding/me`,
    );
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});

test("Sprint 3 care plan route is mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/care-plans`);
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});

test("Sprint 4 admin verification routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/admin/onboarding",
      "/api/v1/admin/client-onboarding",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("admin reports route is mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/admin/reports/overview?range=30d`,
    );
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});

test("admin directory management routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/admin/directory/documents",
      "/api/v1/admin/directory/caregivers/example/status",
      "/api/v1/admin/directory/clients/example",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("Sprint 5 assignment routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/assignments/mine",
      "/api/v1/assignments/attendance/mine",
      "/api/v1/admin/assignments",
      "/api/v1/admin/assignments/visits",
      "/api/v1/admin/assignments/shifts",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("Sprint 6 visit and shift routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/visits/mine",
      "/api/v1/visits/active/mine",
      "/api/v1/shifts/active",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("Sprint 7 map routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/maps/autocomplete?q=Dhanmondi",
      "/api/v1/maps/reverse-geocode?latitude=23.7465&longitude=90.376",
      "/api/v1/maps/route?originLatitude=23.7465&originLongitude=90.376&destinationLatitude=23.81&destinationLongitude=90.41",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("Sprint 8 payment routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/payments/summary",
      "/api/v1/payments/invoices",
      "/api/v1/payments/payslips/transaction/example",
      "/api/v1/admin/payments/overview",
      "/api/v1/admin/dashboard/overview",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("Sprint 9 communication routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/communications/conversations",
      "/api/v1/communications/support-conversation",
      "/api/v1/communications/notifications",
      "/api/v1/admin/communications/conversations",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("Sprint 11 incident routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/api/v1/incidents/mine",
      "/api/v1/admin/incidents",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "UNAUTHENTICATED");
    }
  });
});

test("client medical-document routes are mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/medical-documents/mine`);
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});

test("Sprint 3 caregiver request route is mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/care-requests/available`,
    );
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});

test("Sprint 3 admin matching route is mounted and protected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/admin/care-requests`,
    );
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
});
