import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityService } from "./identityService.js";

const createHarness = (initialAccounts = {}, initialAuthUsers = {}) => {
  const accounts = structuredClone(initialAccounts);
  const authUsers = structuredClone(initialAuthUsers);
  const claimsCalls = [];
  const revoked = [];
  const audits = [];

  const repository = {
    async bootstrap(identity, role) {
      accounts[identity.uid] = {
        uid: identity.uid,
        email: identity.email || "",
        displayName: identity.name || "",
        role: accounts[identity.uid]?.role || role,
        status: accounts[identity.uid]?.status || "active",
      };
      return accounts[identity.uid];
    },
    async getById(uid) {
      return accounts[uid] || null;
    },
    async updateOwnFields(uid, fields) {
      accounts[uid] = { ...accounts[uid], ...fields };
      return accounts[uid];
    },
    async reserveAccountType(uid, role) {
      const account = accounts[uid];
      if (!account) return { outcome: "missing" };
      if (account.role === role) return { outcome: "already_assigned", account };
      if (account.role !== "unassigned") return { outcome: "different_role", account };
      account.pendingRole = role;
      account.roleReservationId = "reservation-1";
      return { outcome: "reserved", reservationId: "reservation-1" };
    },
    async finalizeAccountType(uid, role) {
      accounts[uid] = { ...accounts[uid], role };
      delete accounts[uid].pendingRole;
      delete accounts[uid].roleReservationId;
      return accounts[uid];
    },
    async rollbackAccountType(uid) {
      delete accounts[uid].pendingRole;
      delete accounts[uid].roleReservationId;
    },
    async setAdministrator(uid, authUser, role) {
      accounts[uid] = {
        uid,
        email: authUser.email,
        role,
        status: "active",
      };
      return accounts[uid];
    },
    async recordSessionRevocation(uid, actorUid) {
      audits.push({ uid, actorUid });
    },
  };

  const authentication = {
    async getUser(uid) {
      if (!authUsers[uid]) {
        const error = new Error("missing");
        error.code = "auth/user-not-found";
        throw error;
      }
      return authUsers[uid];
    },
    async setCustomUserClaims(uid, claims) {
      claimsCalls.push({ uid, claims });
      authUsers[uid].customClaims = claims;
    },
    async revokeRefreshTokens(uid) {
      revoked.push(uid);
    },
  };

  return {
    accounts,
    authUsers,
    claimsCalls,
    revoked,
    audits,
    service: createIdentityService({ repository, authentication }),
  };
};

test("bootstrap creates an unassigned public account", async () => {
  const harness = createHarness();
  const result = await harness.service.bootstrap({
    uid: "user-1",
    email: "client@example.com",
    name: "Client User",
  });

  assert.equal(result.account.role, "unassigned");
  assert.deepEqual(result.permissions, ["account:type:select"]);
});

test("bootstrap honors existing protected administrator claims", async () => {
  const harness = createHarness();
  const result = await harness.service.bootstrap({
    uid: "admin-1",
    email: "admin@example.com",
    admin: true,
    role: "super_admin",
  });

  assert.equal(result.account.role, "super_admin");
  assert.deepEqual(result.permissions, ["admin:*"]);
});

test("selecting caregiver assigns claims once and removes admin claim", async () => {
  const harness = createHarness(
    {
      "user-1": { uid: "user-1", role: "unassigned", status: "active" },
    },
    {
      "user-1": {
        uid: "user-1",
        customClaims: { marketing: true, admin: true },
      },
    },
  );

  const result = await harness.service.selectAccountType("user-1", "caregiver");
  assert.equal(result.changed, true);
  assert.equal(result.refreshToken, true);
  assert.equal(result.account.role, "caregiver");
  assert.deepEqual(harness.claimsCalls[0], {
    uid: "user-1",
    claims: { marketing: true, role: "caregiver" },
  });
});

test("account type cannot change after assignment", async () => {
  const harness = createHarness({
    "user-1": { uid: "user-1", role: "client", status: "active" },
  });

  await assert.rejects(
    () => harness.service.selectAccountType("user-1", "caregiver"),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.details.currentRole, "client");
      return true;
    },
  );
});

test("updates only validated shared account fields", async () => {
  const harness = createHarness({
    "user-1": { uid: "user-1", role: "client", status: "active" },
  });
  const account = await harness.service.updateCurrentAccount("user-1", {
    displayName: "  Updated Name  ",
    phone: "+880 1712 345678",
    locale: "BN",
    role: "super_admin",
  });

  assert.equal(account.displayName, "Updated Name");
  assert.equal(account.locale, "bn");
  assert.equal(account.role, "client");
});

test("super-admin claim assignment preserves unrelated claims", async () => {
  const harness = createHarness({}, {
    "admin-2": {
      uid: "admin-2",
      email: "admin2@example.com",
      customClaims: { department: "finance" },
    },
  });

  const account = await harness.service.setAdministratorClaims(
    "admin-2",
    "finance_officer",
    "super-admin-1",
  );
  assert.equal(account.role, "finance_officer");
  assert.deepEqual(harness.claimsCalls[0].claims, {
    department: "finance",
    admin: true,
    role: "finance_officer",
  });
});

test("session revocation calls Firebase Auth and writes an audit record", async () => {
  const harness = createHarness({}, {
    "user-1": { uid: "user-1", email: "client@example.com" },
  });

  const result = await harness.service.revokeSessions(
    "user-1",
    "super-admin-1",
  );
  assert.deepEqual(result, { uid: "user-1", revoked: true });
  assert.deepEqual(harness.revoked, ["user-1"]);
  assert.deepEqual(harness.audits, [{
    uid: "user-1",
    actorUid: "super-admin-1",
  }]);
});
