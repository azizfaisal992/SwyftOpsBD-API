import {
  ACCOUNT_ROLES,
  ADMIN_ROLES,
  isAccountRole,
  isAdminRole,
  permissionsForRole,
} from "../config/roles.js";
import {
  ApiError,
  conflict,
  notFound,
  validationError,
} from "../errors/ApiError.js";

const roleFromIdentity = (identity) => {
  if (identity.admin === true && isAdminRole(identity.role)) return identity.role;
  if (isAccountRole(identity.role)) return identity.role;
  return "unassigned";
};

const publicAccount = (account) => {
  if (!account) return null;
  const {
    pendingRole,
    roleReservationAt,
    roleReservationId,
    ...safeAccount
  } = account;
  void pendingRole;
  void roleReservationAt;
  void roleReservationId;
  return safeAccount;
};

const normalizeOwnFields = (body = {}) => {
  const fields = {};
  if ("displayName" in body) {
    fields.displayName = String(body.displayName || "").trim().slice(0, 100);
    if (!fields.displayName) {
      throw validationError("The request contains invalid fields.", {
        displayName: "Display name cannot be empty.",
      });
    }
  }
  if ("phone" in body) {
    const phone = String(body.phone || "").trim();
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
      throw validationError("The request contains invalid fields.", {
        phone: "Enter a valid phone number.",
      });
    }
    fields.phone = phone;
  }
  if ("locale" in body) {
    const locale = String(body.locale || "").trim().toLowerCase();
    if (!["en", "bn"].includes(locale)) {
      throw validationError("The request contains invalid fields.", {
        locale: "Locale must be en or bn.",
      });
    }
    fields.locale = locale;
  }
  if (Object.keys(fields).length === 0) {
    throw validationError("Provide at least one supported account field.", {
      body: "Supported fields are displayName, phone and locale.",
    });
  }
  return fields;
};

export const createIdentityService = ({ repository, authentication }) => ({
  async bootstrap(identity) {
    const account = await repository.bootstrap(identity, roleFromIdentity(identity));
    return {
      account: publicAccount(account),
      permissions: permissionsForRole(account.role),
    };
  },

  async getCurrentAccount(uid) {
    const account = await repository.getById(uid);
    if (!account) {
      throw new ApiError(
        409,
        "ACCOUNT_NOT_BOOTSTRAPPED",
        "Initialize this Firebase account with POST /users/bootstrap.",
      );
    }
    if (account.status !== "active") {
      throw new ApiError(403, "ACCOUNT_DISABLED", "This account is not active.");
    }
    return publicAccount(account);
  },

  async updateCurrentAccount(uid, body) {
    await this.getCurrentAccount(uid);
    return publicAccount(
      await repository.updateOwnFields(uid, normalizeOwnFields(body)),
    );
  },

  async selectAccountType(uid, requestedRole) {
    if (!ACCOUNT_ROLES.includes(requestedRole)) {
      throw validationError("The request contains invalid fields.", {
        role: "Role must be client or caregiver.",
      });
    }

    const account = await this.getCurrentAccount(uid);
    if (ADMIN_ROLES.includes(account.role)) {
      throw conflict("Administrator accounts cannot select a public account type.");
    }
    if (account.role === requestedRole) {
      return { account, permissions: permissionsForRole(account.role), changed: false };
    }
    if (account.role !== "unassigned") {
      throw conflict(
        `This account is already registered as ${account.role}.`,
        { currentRole: account.role },
      );
    }

    const reservation = await repository.reserveAccountType(uid, requestedRole);
    if (reservation.outcome === "missing") {
      throw notFound("User account not found.");
    }
    if (reservation.outcome === "already_assigned") {
      return {
        account: publicAccount(reservation.account),
        permissions: permissionsForRole(requestedRole),
        changed: false,
      };
    }
    if (reservation.outcome !== "reserved") {
      throw conflict("Another account type has already been selected.");
    }

    try {
      const authUser = await authentication.getUser(uid);
      const customClaims = {
        ...(authUser.customClaims || {}),
        role: requestedRole,
      };
      delete customClaims.admin;
      await authentication.setCustomUserClaims(uid, customClaims);
      const saved = await repository.finalizeAccountType(
        uid,
        requestedRole,
        reservation.reservationId,
      );
      return {
        account: publicAccount(saved),
        permissions: permissionsForRole(requestedRole),
        changed: true,
        refreshToken: true,
      };
    } catch (error) {
      await repository.rollbackAccountType(
        uid,
        requestedRole,
        reservation.reservationId,
      );
      throw error;
    }
  },

  async getPermissions(uid) {
    const account = await this.getCurrentAccount(uid);
    return {
      role: account.role,
      status: account.status,
      permissions: permissionsForRole(account.role),
    };
  },

  async setAdministratorClaims(uid, role, actorUid) {
    if (!isAdminRole(role)) {
      throw validationError("The request contains invalid fields.", {
        role: `Role must be one of: ${ADMIN_ROLES.join(", ")}.`,
      });
    }
    const authUser = await authentication.getUser(uid).catch((error) => {
      if (error.code === "auth/user-not-found") throw notFound("Firebase user not found.");
      throw error;
    });
    await authentication.setCustomUserClaims(uid, {
      ...(authUser.customClaims || {}),
      admin: true,
      role,
    });
    return publicAccount(
      await repository.setAdministrator(uid, authUser, role, actorUid),
    );
  },

  async revokeSessions(uid, actorUid) {
    await authentication.getUser(uid).catch((error) => {
      if (error.code === "auth/user-not-found") throw notFound("Firebase user not found.");
      throw error;
    });
    await authentication.revokeRefreshTokens(uid);
    await repository.recordSessionRevocation(uid, actorUid);
    return { uid, revoked: true };
  },
});
