export const ACCOUNT_ROLES = Object.freeze(["client", "caregiver"]);

export const ADMIN_ROLES = Object.freeze([
  "super_admin",
  "admin",
  "operations_manager",
  "verification_officer",
  "finance_officer",
  "support_agent",
  "analyst",
]);

const permissionsByRole = {
  unassigned: ["account:type:select"],
  client: [
    "client:profile:read",
    "client:profile:write",
    "care-plan:manage",
    "care-request:manage",
  ],
  caregiver: [
    "caregiver:profile:read",
    "caregiver:profile:write",
    "caregiver:onboarding:manage",
    "assignment:respond",
  ],
  super_admin: ["admin:*"],
  admin: ["admin:dashboard:read", "admin:users:read"],
  operations_manager: [
    "admin:dashboard:read",
    "assignment:manage",
    "visit:monitor",
    "incident:manage",
  ],
  verification_officer: [
    "verification:read",
    "verification:decide",
    "document:review",
  ],
  finance_officer: ["finance:read", "invoice:manage", "payout:manage"],
  support_agent: ["conversation:oversight", "incident:manage"],
  analyst: ["report:read", "audit:read"],
};

export const isAccountRole = (role) => ACCOUNT_ROLES.includes(role);
export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

export const permissionsForRole = (role) =>
  Object.freeze([...(permissionsByRole[role] || [])]);
