import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

const profileCollectionForRole = {
  client: "clientProfiles",
  caregiver: "caregiverProfiles",
};

export const createUserRepository = (database) => {
  const users = database.collection("users");

  return Object.freeze({
    async getById(uid) {
      const snapshot = await users.doc(uid).get();
      return snapshot.exists ? snapshot.data() : null;
    },

    async bootstrap(identity, role) {
      const reference = users.doc(identity.uid);
      const snapshot = await reference.get();
      const now = FieldValue.serverTimestamp();
      const data = {
        uid: identity.uid,
        email: identity.email || "",
        displayName: identity.name || "",
        photoURL: identity.picture || "",
        emailVerified: identity.email_verified === true,
        status: snapshot.exists ? snapshot.data().status || "active" : "active",
        role: snapshot.exists ? snapshot.data().role || role : role,
        updatedAt: now,
        lastLoginAt: now,
      };
      if (!snapshot.exists) data.createdAt = now;
      await reference.set(data, { merge: true });
      const saved = await reference.get();
      return saved.data();
    },

    async updateOwnFields(uid, fields) {
      const reference = users.doc(uid);
      await reference.set({
        ...fields,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return (await reference.get()).data();
    },

    async reserveAccountType(uid, role) {
      const reservationId = randomUUID();
      return database.runTransaction(async (transaction) => {
        const reference = users.doc(uid);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return { outcome: "missing" };

        const account = snapshot.data();
        if (account.role === role) return { outcome: "already_assigned", account };
        if (account.role !== "unassigned") {
          return { outcome: "different_role", account };
        }
        if (account.pendingRole && account.pendingRole !== role) {
          return { outcome: "different_role_pending", account };
        }

        transaction.update(reference, {
          pendingRole: role,
          roleReservationId: reservationId,
          roleReservationAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { outcome: "reserved", reservationId };
      });
    },

    async finalizeAccountType(uid, role, reservationId) {
      const profileCollection = profileCollectionForRole[role];
      return database.runTransaction(async (transaction) => {
        const reference = users.doc(uid);
        const snapshot = await transaction.get(reference);
        const account = snapshot.data();
        if (
          !snapshot.exists ||
          account.pendingRole !== role ||
          account.roleReservationId !== reservationId
        ) {
          throw new Error("The account type reservation is no longer valid.");
        }

        transaction.update(reference, {
          role,
          pendingRole: FieldValue.delete(),
          roleReservationId: FieldValue.delete(),
          roleReservationAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(database.collection(profileCollection).doc(uid), {
          uid,
          onboardingStatus: "not_started",
          verificationStatus: "unverified",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }).then(async () => (await users.doc(uid).get()).data());
    },

    async rollbackAccountType(uid, role, reservationId) {
      await database.runTransaction(async (transaction) => {
        const reference = users.doc(uid);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return;
        const account = snapshot.data();
        if (
          account.pendingRole === role &&
          account.roleReservationId === reservationId
        ) {
          transaction.update(reference, {
            pendingRole: FieldValue.delete(),
            roleReservationId: FieldValue.delete(),
            roleReservationAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    },

    async setAdministrator(uid, authUser, role, actorUid) {
      const batch = database.batch();
      const now = FieldValue.serverTimestamp();
      batch.set(users.doc(uid), {
        uid,
        email: authUser.email || "",
        displayName: authUser.displayName || "",
        photoURL: authUser.photoURL || "",
        emailVerified: authUser.emailVerified === true,
        role,
        status: authUser.disabled ? "disabled" : "active",
        updatedAt: now,
      }, { merge: true });
      batch.set(database.collection("adminProfiles").doc(uid), {
        uid,
        role,
        status: authUser.disabled ? "disabled" : "active",
        updatedAt: now,
      }, { merge: true });
      batch.set(database.collection("auditLogs").doc(), {
        actorId: actorUid,
        action: "admin.claims.updated",
        resourceType: "user",
        resourceId: uid,
        changes: { admin: true, role },
        createdAt: now,
      });
      await batch.commit();
      return (await users.doc(uid).get()).data();
    },

    async recordSessionRevocation(uid, actorUid) {
      await database.collection("auditLogs").add({
        actorId: actorUid,
        action: "user.sessions.revoked",
        resourceType: "user",
        resourceId: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    },
  });
};
