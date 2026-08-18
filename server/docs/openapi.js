const routeGroups = {
  System: [
    "get /api/v1/health|Check API health|public",
  ],
  Identity: [
    "post /api/v1/users/bootstrap|Create or synchronize the signed-in account",
    "get /api/v1/users/me|Read the current account",
    "patch /api/v1/users/me|Update shared account fields",
    "post /api/v1/users/me/account-type|Select client or caregiver account type",
    "get /api/v1/users/me/permissions|Read effective permissions",
  ],
  "Caregiver onboarding": [
    "get /api/v1/onboarding/me|Read caregiver onboarding|caregiver",
    "put /api/v1/onboarding/profile|Save caregiver profile|caregiver",
    "put /api/v1/onboarding/assessment|Save caregiver assessment|caregiver",
    "post /api/v1/onboarding/files/{kind}|Upload a private onboarding document|caregiver",
    "delete /api/v1/onboarding/files/{kind}|Delete a private onboarding document|caregiver",
    "post /api/v1/onboarding/submit|Submit caregiver onboarding for verification|caregiver",
  ],
  "Client onboarding": [
    "get /api/v1/client-onboarding/me|Read client onboarding|client",
    "put /api/v1/client-onboarding/profile|Save client profile|client",
    "put /api/v1/client-onboarding/contact|Save contact and pinned location|client",
    "post /api/v1/client-onboarding/files/{kind}|Upload a client NID or medical report|client",
    "delete /api/v1/client-onboarding/files/{kind}|Delete a client NID document|client",
    "delete /api/v1/client-onboarding/files/medicalReport/{fileId}|Delete a medical report|client",
    "post /api/v1/client-onboarding/submit|Submit client onboarding for verification|client",
  ],
  "Public directory": [
    "get /api/v1/directory/caregivers|List approved public caregivers|public",
    "get /api/v1/directory/caregivers/{caregiverId}/photo|Read an approved caregiver photo|public",
  ],
  "Care plans": [
    "get /api/v1/care-plans|List the client's care plans|client",
    "get /api/v1/care-plans/requests/mine|List the client's published requests|client",
    "post /api/v1/care-plans|Create a draft care plan|client",
    "get /api/v1/care-plans/{planId}|Read an owned care plan|client",
    "put /api/v1/care-plans/{planId}|Update an owned draft|client",
    "post /api/v1/care-plans/{planId}/submit|Publish a verified client's request|client",
  ],
  "Caregiver requests": [
    "get /api/v1/care-requests/available|List available care requests|approved caregiver",
    "get /api/v1/care-requests/{requestId}|Read an available care request|approved caregiver",
    "post /api/v1/care-requests/{requestId}/respond|Accept or decline a request|approved caregiver",
  ],
  Assignments: [
    "get /api/v1/assignments/mine|List owned assignments|client or caregiver",
    "get /api/v1/assignments/visits/mine|List owned scheduled visits|client or caregiver",
    "get /api/v1/assignments/attendance/mine|Read client attendance and calendar|client",
    "get /api/v1/assignments/{assignmentId}/caregiver-verification|Read assigned caregiver verification|assigned client",
    "get /api/v1/assignments/{assignmentId}/caregiver-photo|Read assigned caregiver photo|assigned client",
    "patch /api/v1/assignments/{assignmentId}/confirm|Confirm a pending assignment|assigned caregiver",
    "get /api/v1/assignments/{assignmentId}|Read an owned assignment|client or caregiver",
  ],
  Visits: [
    "get /api/v1/visits/mine|List owned visits|client or caregiver",
    "get /api/v1/visits/active/mine|Restore the active visit|client or caregiver",
    "get /api/v1/visits/{visitId}|Read an owned visit|client or caregiver",
    "post /api/v1/visits/{visitId}/clock-in|Clock in to a confirmed visit|assigned caregiver",
    "patch /api/v1/visits/{visitId}/progress|Save visit tasks and care notes|assigned caregiver",
    "patch /api/v1/visits/{visitId}/location|Update active visit GPS|assigned caregiver",
    "post /api/v1/visits/{visitId}/complete|Clock out and submit the visit report|assigned caregiver",
  ],
  Shifts: [
    "get /api/v1/shifts/mine|List caregiver shift history|caregiver",
    "get /api/v1/shifts/active|Restore the active shift|caregiver",
    "post /api/v1/shifts/clock-in|Start a caregiver shift|caregiver",
    "post /api/v1/shifts/clock-out|Complete the active shift|caregiver",
    "patch /api/v1/shifts/location|Update active shift GPS|caregiver",
  ],
  Maps: [
    "get /api/v1/maps/autocomplete|Search Bangladesh addresses",
    "get /api/v1/maps/reverse-geocode|Reverse geocode a coordinate",
    "get /api/v1/maps/route|Calculate a route",
  ],
  "Medical documents": [
    "get /api/v1/medical-documents/mine|List owned medical documents|client",
    "post /api/v1/medical-documents|Upload a protected medical document|client",
    "put /api/v1/medical-documents/instructions|Save medication instructions|client",
    "get /api/v1/medical-documents/{documentId}/download|Download an owned medical document|client",
  ],
  Payments: [
    "get /api/v1/payments/sessions/{sessionId}|Read an owned payment session|client",
    "get /api/v1/payments/summary|Read role-specific finance summary|client or caregiver",
    "get /api/v1/payments/billing|Read staged client billing|client",
    "post /api/v1/payments/care-plans/{carePlanId}/billing|Create staged care-plan billing|client",
    "get /api/v1/payments/invoices|List owned invoices|client",
    "get /api/v1/payments/transactions|List owned transactions|client or caregiver",
    "get /api/v1/payments/payslips/{recordType}/{recordId}|Download a SwiftOpsBD payslip|owner or admin",
    "get /api/v1/payments/invoices/{invoiceId}/swiftopsbd-invoice|Download a SwiftOpsBD invoice|client owner or admin",
    "post /api/v1/payments/invoices/{invoiceId}/checkout|Create hosted checkout|client",
    "post /api/v1/payments/sessions/{sessionId}/simulate|Simulate local payment (non-production)|client",
    "post /api/v1/payments/withdrawals|Request caregiver withdrawal|caregiver",
  ],
  "Payment callbacks": [
    "post /api/v1/payments/sslcommerz/success|Handle SSLCommerz success|public",
    "post /api/v1/payments/sslcommerz/fail|Handle SSLCommerz failure|public",
    "post /api/v1/payments/sslcommerz/cancel|Handle SSLCommerz cancellation|public",
    "post /api/v1/payments/sslcommerz/ipn|Handle SSLCommerz IPN|public",
    "post /api/v1/payments/stripe/webhook|Handle signed Stripe webhook|public",
  ],
  Communications: [
    "get /api/v1/communications/conversations|List owned conversations",
    "post /api/v1/communications/conversations|Create an assignment conversation",
    "post /api/v1/communications/support-conversation|Create an admin support conversation",
    "get /api/v1/communications/conversations/{conversationId}/messages|List conversation messages",
    "post /api/v1/communications/conversations/{conversationId}/messages|Send a message",
    "patch /api/v1/communications/conversations/{conversationId}/read|Mark conversation read",
    "get /api/v1/communications/notifications|List private notifications",
    "patch /api/v1/communications/notifications/read-all|Mark all notifications read",
    "patch /api/v1/communications/notifications/{notificationId}/read|Mark one notification read",
  ],
  Incidents: [
    "get /api/v1/incidents/mine|List owned incidents|client or caregiver",
    "get /api/v1/incidents/{incidentId}|Read an owned incident|client or caregiver",
    "post /api/v1/incidents|Report an incident or SOS|client or caregiver",
  ],
  "Admin dashboard": ["get /api/v1/admin/dashboard/overview|Read operational metrics|admin"],
  "Admin reports": ["get /api/v1/admin/reports/overview|Generate operational and finance reports|admin"],
  "Admin verification": [
    "get /api/v1/admin/onboarding|List caregiver verification records|admin",
    "patch /api/v1/admin/onboarding/{caregiverId}/review|Review caregiver verification|admin",
    "get /api/v1/admin/onboarding/{caregiverId}/files/{kind}/url|Create caregiver document URL|admin",
    "get /api/v1/admin/onboarding/{caregiverId}/files/{kind}/download|Download caregiver document|admin",
    "get /api/v1/admin/client-onboarding|List client verification records|admin",
    "patch /api/v1/admin/client-onboarding/{clientId}/review|Review client verification|admin",
    "get /api/v1/admin/client-onboarding/{clientId}/files/{kind}/url|Create client document URL|admin",
    "get /api/v1/admin/client-onboarding/{clientId}/files/{kind}/download|Download client document|admin",
  ],
  "Admin matching": [
    "get /api/v1/admin/care-requests|List all care requests|admin",
    "post /api/v1/admin/care-requests/reconcile-paid|Reconcile paid plans into requests|admin",
    "get /api/v1/admin/care-requests/{requestId}|Read request and ranked caregivers|admin",
    "patch /api/v1/admin/care-requests/{requestId}|Hold, reopen, decline, assign, or auto-match|admin",
  ],
  "Admin assignments": [
    "get /api/v1/admin/assignments|List all assignments|admin",
    "get /api/v1/admin/assignments/visits|Read administrator visit calendar|admin",
    "get /api/v1/admin/assignments/shifts|Read duty and GPS status|admin",
  ],
  "Admin finance": [
    "get /api/v1/admin/payments/overview|Read reconciled finance metrics|admin",
    "get /api/v1/admin/payments/invoices|List all client invoices|admin",
    "post /api/v1/admin/payments/invoices|Create a server-priced invoice|admin",
    "get /api/v1/admin/payments/payouts|List caregiver payouts|admin",
    "get /api/v1/admin/payments/assignment-payout-quotes|Calculate payable assignment balances|admin",
    "post /api/v1/admin/payments/assignment-payouts|Record an assignment payout|admin",
    "patch /api/v1/admin/payments/payouts/{payoutId}|Process or reject withdrawal|admin",
  ],
  "Admin communications": [
    "get /api/v1/admin/communications/conversations|List support and flagged conversations|admin",
    "get /api/v1/admin/communications/conversations/{conversationId}/messages|Read support messages|support admin",
    "post /api/v1/admin/communications/conversations/{conversationId}/messages|Send support reply|support admin",
    "patch /api/v1/admin/communications/conversations/{conversationId}/flag|Flag or unflag conversation|admin",
    "patch /api/v1/admin/communications/conversations/{conversationId}/support|Assign support agent|admin",
  ],
  "Admin incidents": [
    "get /api/v1/admin/incidents|List incidents and SOS cases|admin",
    "get /api/v1/admin/incidents/{incidentId}|Read an incident case|admin",
    "patch /api/v1/admin/incidents/{incidentId}|Review, resolve, or escalate incident|admin",
  ],
  "Admin directory": [
    "patch /api/v1/admin/directory/caregivers/{caregiverId}/status|Activate or suspend caregiver|admin",
    "patch /api/v1/admin/directory/caregivers/{caregiverId}/directory|Control public directory visibility|admin",
    "patch /api/v1/admin/directory/caregivers/{caregiverId}/profile|Edit caregiver directory profile|admin",
    "patch /api/v1/admin/directory/clients/{clientId}|Edit client details|admin",
    "post /api/v1/admin/directory/clients/{clientId}/renew-care|Renew previous care|admin",
    "delete /api/v1/admin/directory/clients/{clientId}|Delete client and owned records|admin",
    "get /api/v1/admin/directory/documents|List system documents|admin",
    "get /api/v1/admin/directory/documents/{documentId}/download|Download system document|admin",
  ],
  "Admin users": [
    "post /api/v1/admin/users/{uid}/claims|Set protected administrator claims|super_admin",
    "post /api/v1/admin/users/{uid}/revoke-sessions|Revoke Firebase sessions|super_admin",
  ],
};

const examples = {
  "/api/v1/users/bootstrap": { displayName: "Abdul Aziz Faisal" },
  "/api/v1/users/me": { displayName: "Abdul Aziz Faisal", photoURL: "https://example.com/photo.jpg" },
  "/api/v1/users/me/account-type": { accountType: "client" },
  "/api/v1/onboarding/profile": { fullName: "Rahima Khatun", dateOfBirth: "1990-05-12", gender: "Female", phone: "+8801712345678", city: "Dhaka", zipCode: "1212", services: ["Senior Care", "Home Nursing"], hourlyRate: 850 },
  "/api/v1/onboarding/assessment": { availability: ["Mon", "Wed", "Fri"], preferredShift: "Mornings", emergencyReady: true },
  "/api/v1/onboarding/submit": { confirmed: true },
  "/api/v1/client-onboarding/profile": { fullName: "Fatema Begum", dateOfBirth: "1952-05-15", gender: "Female", nidNumber: "1234567890" },
  "/api/v1/client-onboarding/contact": { phone: "+8801711223344", email: "client@example.com", area: "Gulshan", road: "Road 12", house: "House 24", location: { latitude: 23.7925, longitude: 90.4078 } },
  "/api/v1/client-onboarding/submit": { confirmed: true },
  "/api/v1/care-plans": { careType: "Senior Care", tasks: ["Medication Reminders", "Mobility Assistance"], hoursPerWeek: 20, preferredDays: ["Mon", "Wed", "Fri"], preferredTime: "Mornings", preferredStartTime: "09:00", serviceStartDate: "2026-08-03", serviceEndDate: "2026-08-31", caregiverGender: "No Preference", budgetRange: "15000-25000" },
  "/api/v1/care-requests/{requestId}/respond": { decision: "accepted", note: "Available for the requested schedule." },
  "/api/v1/visits/{visitId}/progress": { completedTasks: ["Medication Reminders"], careNotes: "Medication administered." },
  "/api/v1/payments/invoices/{invoiceId}/checkout": { gateway: "stripe", phone: "+8801712345678" },
  "/api/v1/payments/withdrawals": { amount: 5000, method: "bKash", accountNumber: "01700000000" },
  "/api/v1/communications/conversations/{conversationId}/messages": { text: "Hello, I am on my way." },
  "/api/v1/admin/care-requests/{requestId}": { action: "assign", caregiverId: "firebase-caregiver-uid" },
  "/api/v1/admin/onboarding/{caregiverId}/review": { decision: "approved", note: "Documents verified." },
  "/api/v1/admin/client-onboarding/{clientId}/review": { decision: "approved", note: "Identity verified." },
  "/api/v1/admin/payments/assignment-payouts": { assignmentId: "assignment-id", method: "bKash", note: "Service payout" },
};

const uploads = new Set([
  "/api/v1/onboarding/files/{kind}",
  "/api/v1/client-onboarding/files/{kind}",
  "/api/v1/medical-documents",
]);

const downloads = new Set([
  "/api/v1/directory/caregivers/{caregiverId}/photo",
  "/api/v1/assignments/{assignmentId}/caregiver-photo",
  "/api/v1/medical-documents/{documentId}/download",
  "/api/v1/payments/payslips/{recordType}/{recordId}",
  "/api/v1/payments/invoices/{invoiceId}/swiftopsbd-invoice",
  "/api/v1/admin/onboarding/{caregiverId}/files/{kind}/download",
  "/api/v1/admin/client-onboarding/{clientId}/files/{kind}/download",
  "/api/v1/admin/directory/documents/{documentId}/download",
]);

const queryParameters = {
  "/api/v1/assignments/visits/mine": ["from", "to"],
  "/api/v1/visits/mine": ["status"],
  "/api/v1/maps/autocomplete": ["q"],
  "/api/v1/maps/reverse-geocode": ["latitude", "longitude"],
  "/api/v1/maps/route": ["originLatitude", "originLongitude", "destinationLatitude", "destinationLongitude", "profile"],
  "/api/v1/medical-documents/{documentId}/download": ["source"],
  "/api/v1/admin/reports/overview": ["from", "to"],
  "/api/v1/admin/assignments/visits": ["from", "to"],
  "/api/v1/admin/assignments/shifts": ["status"],
  "/api/v1/admin/incidents": ["status", "type", "priority"],
};

const bodyMethods = new Set(["post", "put", "patch", "delete"]);
const paths = {};

for (const [tag, routes] of Object.entries(routeGroups)) {
  for (const definition of routes) {
    const [route, summary, access = "authenticated"] = definition.split("|");
    const [method, path] = route.split(" ");
    const parameters = [
      ...[...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
        name: match[1], in: "path", required: true,
        schema: { type: "string" },
      })),
      ...(queryParameters[path] || []).map((name) => ({
        name, in: "query", required: path.includes("/maps/") && name !== "profile",
        schema: { type: ["latitude", "longitude"].some((part) => name.includes(part)) ? "number" : "string" },
      })),
    ];
    const binary = downloads.has(path);
    const operation = {
      tags: [tag], summary,
      description: access === "public" ? undefined : `Required access: ${access}.`,
      operationId: `${method}_${path}`.replace(/[^a-zA-Z0-9]+/g, "_"),
      parameters: parameters.length ? parameters : undefined,
      security: access === "public" ? [] : [{ firebaseBearer: [] }],
      responses: {
        200: binary ? {
          description: "Protected binary response",
          content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
        } : {
          description: "Successful response",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiEnvelope" } } },
        },
        400: { $ref: "#/components/responses/BadRequest" },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
        404: { $ref: "#/components/responses/NotFound" },
        409: { $ref: "#/components/responses/Conflict" },
      },
    };
    if (uploads.has(path)) {
      operation.requestBody = {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } },
      };
    } else if (bodyMethods.has(method) && !path.endsWith("stripe/webhook")) {
      operation.requestBody = {
        required: false,
        content: { "application/json": { schema: { type: "object", additionalProperties: true }, example: examples[path] || { confirmed: true } } },
      };
    }
    paths[path] ||= {};
    paths[path][method] = operation;
  }
}

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "SwiftOpsBD REST API",
    version: "1.0.0",
    description: "REST API for SwiftOpsBD clients, caregivers, and administrators. Use Authorize with a Firebase ID token. Never enter service-account, Stripe, Supabase, card, PIN, CVV, or OTP secrets here.",
  },
  servers: [
    { url: "http://localhost:4000", description: "Local API" },
    { url: "/", description: "Current deployed API" },
  ],
  tags: Object.keys(routeGroups).map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      firebaseBearer: {
        type: "http", scheme: "bearer", bearerFormat: "Firebase ID token",
        description: "Paste the Firebase ID token only; Swagger adds Bearer automatically.",
      },
    },
    schemas: {
      ApiEnvelope: { type: "object", properties: { data: {}, meta: { type: "object", additionalProperties: true } } },
      ApiError: { type: "object", properties: { error: { type: "object", additionalProperties: true }, meta: { type: "object", additionalProperties: true } } },
    },
    responses: {
      BadRequest: { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
      Unauthorized: { description: "Missing, invalid, or expired Firebase ID token" },
      Forbidden: { description: "Account role cannot perform this action" },
      NotFound: { description: "Resource not found" },
      Conflict: { description: "Request conflicts with current state" },
    },
  },
};

export default openApiDocument;
