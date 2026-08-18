import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessConversation,
  createConversation,
  createMessage,
  createMessageNotification,
  createSupportConversation,
  unreadCount,
} from "./communicationModel.js";

const assignment = {
  assignmentId: "asn_1",
  requestId: "req_1",
  clientId: "client_1",
  clientName: "Fatema Begum",
  caregiverId: "caregiver_1",
  caregiverName: "Rahima Khatun",
  serviceType: "Post-op care",
};

test("creates an assignment conversation with only its two participants", () => {
  const conversation = createConversation({
    conversationId: "conversation_1",
    assignment,
    now: "2026-07-27T10:00:00.000Z",
  });
  assert.deepEqual(conversation.participantIds, ["client_1", "caregiver_1"]);
  assert.equal(conversation.assignmentId, "asn_1");
  assert.equal(conversation.subject, "Post-op care");
});

test("creates a support conversation addressed to admins without exposing assignments", () => {
  const conversation = createSupportConversation({
    conversationId: "support_1",
    user: {
      uid: "client_1",
      role: "client",
      name: "Fatema Begum",
    },
  });
  assert.equal(conversation.type, "support");
  assert.equal(conversation.ownerId, "client_1");
  assert.deepEqual(conversation.participantIds, ["client_1"]);
  assert.equal(conversation.assignmentId, "");
});

test("requires non-empty message text and trims supported text", () => {
  const message = createMessage({
    messageId: "message_1",
    conversationId: "conversation_1",
    sender: { uid: "client_1", role: "client", name: "Fatema" },
    body: "  I need help with my medicine.  ",
  });
  assert.equal(message.body, "I need help with my medicine.");
  assert.throws(() => createMessage({
    messageId: "message_2",
    conversationId: "conversation_1",
    sender: { uid: "client_1", role: "client" },
    body: " ",
  }));
});

test("creates a private notification for the other participant", () => {
  const conversation = createConversation({
    conversationId: "conversation_1",
    assignment,
  });
  const message = createMessage({
    messageId: "message_1",
    conversationId: conversation.conversationId,
    sender: { uid: "client_1", role: "client", name: "Fatema" },
    body: "Hello",
  });
  const notification = createMessageNotification({
    notificationId: "notification_1",
    conversation,
    message,
    recipientId: "caregiver_1",
  });
  assert.equal(notification.userId, "caregiver_1");
  assert.equal(notification.read, false);
});

test("checks access and derives unread messages since the read marker", () => {
  const conversation = createConversation({
    conversationId: "conversation_1",
    assignment,
  });
  assert.equal(canAccessConversation(conversation, "client_1"), true);
  assert.equal(canAccessConversation(conversation, "stranger"), false);
  assert.equal(unreadCount([
    { senderId: "caregiver_1", createdAt: "2026-07-27T10:00:00.000Z" },
    { senderId: "client_1", createdAt: "2026-07-27T10:01:00.000Z" },
    { senderId: "caregiver_1", createdAt: "2026-07-27T10:02:00.000Z" },
  ], "client_1", "2026-07-27T10:00:30.000Z"), 1);
});
