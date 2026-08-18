import { Router } from "express";
import { forbidden, notFound } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  canAccessConversation,
  createConversation,
  createMessage,
  createMessageNotification,
  createSupportConversation,
  unreadCount,
} from "../communicationModel.js";

const router = Router();
router.use(authenticate);

const requirePortalUser = (user) => {
  if (!["client", "caregiver"].includes(user.role)) {
    throw forbidden("Only clients and caregivers can access conversations.");
  }
};

const ownedConversation = async (conversationId, user) => {
  requirePortalUser(user);
  const reference = db.collection("conversations").doc(conversationId);
  const snapshot = await reference.get();
  if (!snapshot.exists || !canAccessConversation(snapshot.data(), user.uid)) {
    throw notFound("Conversation not found.");
  }
  return { reference, conversation: snapshot.data() };
};

const conversationMessages = async (conversationId, limit = 200) => {
  const snapshot = await db.collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .limit(limit)
    .get();
  return snapshot.docs
    .map((document) => document.data())
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
};

router.get("/conversations", async (request, response, next) => {
  try {
    requirePortalUser(request.user);
    const snapshot = await db.collection("conversations")
      .where("participantIds", "array-contains", request.user.uid)
      .limit(100)
      .get();
    const records = await Promise.all(snapshot.docs.map(async (document) => {
      const conversation = document.data();
      const messages = await conversationMessages(conversation.conversationId);
      return {
        ...conversation,
        unreadCount: unreadCount(
          messages,
          request.user.uid,
          conversation.lastReadAtBy?.[request.user.uid] || "",
        ),
      };
    }));
    records.sort((a, b) =>
      String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations", async (request, response, next) => {
  try {
    requirePortalUser(request.user);
    const assignmentId = String(request.body.assignmentId || "").trim();
    if (!assignmentId) throw notFound("Assignment not found.");
    const assignmentSnapshot = await db.collection("assignments")
      .doc(assignmentId)
      .get();
    if (!assignmentSnapshot.exists) throw notFound("Assignment not found.");
    const assignment = assignmentSnapshot.data();
    if (
      assignment.clientId !== request.user.uid &&
      assignment.caregiverId !== request.user.uid
    ) {
      throw notFound("Assignment not found.");
    }
    const existingSnapshot = await db.collection("conversations")
      .where("assignmentId", "==", assignmentId)
      .limit(10)
      .get();
    const existing = existingSnapshot.docs
      .map((document) => document.data())
      .find((record) => record.type === "assignment");
    if (existing) return response.json({ data: existing });

    const reference = db.collection("conversations").doc();
    const conversation = createConversation({
      conversationId: reference.id,
      assignment,
    });
    await reference.set(conversation);
    return response.status(201).json({ data: conversation });
  } catch (error) {
    return next(error);
  }
});

router.post("/support-conversation", async (request, response, next) => {
  try {
    requirePortalUser(request.user);
    const existingSnapshot = await db.collection("conversations")
      .where("ownerId", "==", request.user.uid)
      .limit(10)
      .get();
    const existing = existingSnapshot.docs
      .map((document) => document.data())
      .find((record) => record.type === "support");
    if (existing) return response.json({ data: existing });

    const reference = db.collection("conversations").doc();
    const conversation = createSupportConversation({
      conversationId: reference.id,
      user: request.user,
    });
    await reference.set(conversation);
    return response.status(201).json({ data: conversation });
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:conversationId/messages", async (
  request,
  response,
  next,
) => {
  try {
    await ownedConversation(request.params.conversationId, request.user);
    return response.json({
      data: await conversationMessages(request.params.conversationId),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:conversationId/messages", async (
  request,
  response,
  next,
) => {
  try {
    const { reference, conversation } = await ownedConversation(
      request.params.conversationId,
      request.user,
    );
    const messageReference = reference.collection("messages").doc();
    const message = createMessage({
      messageId: messageReference.id,
      conversationId: conversation.conversationId,
      sender: request.user,
      body: request.body.body,
    });
    const recipientIds = conversation.participantIds
      .filter((uid) => uid !== request.user.uid);
    const batch = db.batch();
    batch.set(messageReference, message);
    batch.set(reference, {
      lastMessage: {
        body: message.body,
        senderId: message.senderId,
        senderName: message.senderName,
      },
      lastMessageAt: message.createdAt,
      updatedAt: message.createdAt,
      lastReadAtBy: {
        ...(conversation.lastReadAtBy || {}),
        [request.user.uid]: message.createdAt,
      },
    }, { merge: true });
    recipientIds.forEach((recipientId) => {
      const notificationReference = db.collection("notifications").doc();
      batch.set(notificationReference, createMessageNotification({
        notificationId: notificationReference.id,
        conversation,
        message,
        recipientId,
        now: message.createdAt,
      }));
    });
    await batch.commit();
    return response.status(201).json({ data: message });
  } catch (error) {
    return next(error);
  }
});

router.patch("/conversations/:conversationId/read", async (
  request,
  response,
  next,
) => {
  try {
    const { reference, conversation } = await ownedConversation(
      request.params.conversationId,
      request.user,
    );
    const now = new Date().toISOString();
    const lastReadAtBy = {
      ...(conversation.lastReadAtBy || {}),
      [request.user.uid]: now,
    };
    await reference.set({ lastReadAtBy, updatedAt: now }, { merge: true });
    return response.json({ data: { conversationId: reference.id, readAt: now } });
  } catch (error) {
    return next(error);
  }
});

router.get("/notifications", async (request, response, next) => {
  try {
    const snapshot = await db.collection("notifications")
      .where("userId", "==", request.user.uid)
      .limit(200)
      .get();
    let records = snapshot.docs.map((document) => document.data());
    if (request.query.unread === "true") {
      records = records.filter((notification) => !notification.read);
    }
    records.sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.patch("/notifications/read-all", async (request, response, next) => {
  try {
    const snapshot = await db.collection("notifications")
      .where("userId", "==", request.user.uid)
      .limit(500)
      .get();
    const now = new Date().toISOString();
    const batch = db.batch();
    snapshot.docs.forEach((document) => {
      batch.set(document.ref, { read: true, readAt: now, updatedAt: now }, {
        merge: true,
      });
    });
    await batch.commit();
    return response.json({ data: { updated: snapshot.size, readAt: now } });
  } catch (error) {
    return next(error);
  }
});

router.patch("/notifications/:notificationId/read", async (
  request,
  response,
  next,
) => {
  try {
    const reference = db.collection("notifications")
      .doc(request.params.notificationId);
    const snapshot = await reference.get();
    if (!snapshot.exists || snapshot.data().userId !== request.user.uid) {
      throw notFound("Notification not found.");
    }
    const now = new Date().toISOString();
    await reference.set({ read: true, readAt: now, updatedAt: now }, {
      merge: true,
    });
    return response.json({
      data: { ...snapshot.data(), read: true, readAt: now, updatedAt: now },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
