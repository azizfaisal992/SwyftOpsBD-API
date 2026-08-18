import { validationError } from "./errors/ApiError.js";

const cleanText = (value, maximum = 4000) =>
  String(value ?? "").trim().slice(0, maximum);

const safeRole = (role) =>
  ["client", "caregiver", "support", "admin"].includes(role)
    ? role
    : "user";

export const assignmentParticipants = (assignment) => {
  if (!assignment?.clientId || !assignment?.caregiverId) {
    throw validationError("The assignment does not have both participants.");
  }
  return [
    {
      uid: assignment.clientId,
      role: "client",
      name: cleanText(assignment.clientName || "Client", 120),
      photoUrl: cleanText(assignment.clientPhotoUrl, 1000),
    },
    {
      uid: assignment.caregiverId,
      role: "caregiver",
      name: cleanText(assignment.caregiverName || "Caregiver", 120),
      photoUrl: cleanText(assignment.caregiverPhotoUrl, 1000),
    },
  ];
};

export const createConversation = ({
  conversationId,
  assignment,
  now = new Date().toISOString(),
}) => {
  const participants = assignmentParticipants(assignment);
  return {
    conversationId,
    type: "assignment",
    assignmentId: assignment.assignmentId,
    careRequestId: assignment.requestId || assignment.careRequestId || "",
    participantIds: participants.map((participant) => participant.uid),
    participants,
    subject: cleanText(
      assignment.serviceType || assignment.careType || "Care assignment",
      160,
    ),
    lastMessage: null,
    lastMessageAt: now,
    lastReadAtBy: {},
    flagged: false,
    flagReason: "",
    supportStatus: "unassigned",
    assignedAdminId: "",
    createdAt: now,
    updatedAt: now,
  };
};

export const createSupportConversation = ({
  conversationId,
  user,
  now = new Date().toISOString(),
}) => ({
  conversationId,
  type: "support",
  ownerId: user.uid,
  assignmentId: "",
  careRequestId: "",
  participantIds: [user.uid],
  participants: [
    {
      uid: user.uid,
      role: safeRole(user.role),
      name: cleanText(user.name || user.email || "User", 120),
      photoUrl: cleanText(user.picture, 1000),
    },
    {
      uid: "admin-team",
      role: "support",
      name: "SwiftOpsBD Support",
      photoUrl: "",
    },
  ],
  subject: "SwiftOpsBD Support",
  lastMessage: null,
  lastMessageAt: now,
  lastReadAtBy: {},
  flagged: false,
  flagReason: "",
  supportStatus: "unassigned",
  assignedAdminId: "",
  createdAt: now,
  updatedAt: now,
});

export const createMessage = ({
  messageId,
  conversationId,
  sender,
  body,
  now = new Date().toISOString(),
}) => {
  const normalizedBody = cleanText(body);
  if (!normalizedBody) {
    throw validationError("Enter a message before sending.", {
      body: "Message is required.",
    });
  }
  return {
    messageId,
    conversationId,
    senderId: sender.uid,
    senderRole: safeRole(sender.role),
    senderName: cleanText(sender.name || sender.email || "User", 120),
    body: normalizedBody,
    createdAt: now,
  };
};

export const createMessageNotification = ({
  notificationId,
  conversation,
  message,
  recipientId,
  now = new Date().toISOString(),
}) => ({
  notificationId,
  userId: recipientId,
  type: "message",
  title: `New message from ${message.senderName}`,
  body: message.body.slice(0, 180),
  conversationId: conversation.conversationId,
  assignmentId: conversation.assignmentId,
  read: false,
  createdAt: now,
  updatedAt: now,
});

export const canAccessConversation = (conversation, uid) =>
  Array.isArray(conversation?.participantIds) &&
  conversation.participantIds.includes(uid);

export const unreadCount = (messages, uid, lastReadAt = "") =>
  messages.filter(
    (message) =>
      message.senderId !== uid &&
      (!lastReadAt || String(message.createdAt) > String(lastReadAt)),
  ).length;
