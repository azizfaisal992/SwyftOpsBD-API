import { Router } from "express";
import { notFound } from "../errors/ApiError.js";
import { db } from "../firebaseAdmin.js";
import { authenticate, requireAdmin } from "../middleware/authenticate.js";
import {
  createMessage,
  createMessageNotification,
} from "../communicationModel.js";

const router = Router();
router.use(authenticate, requireAdmin);

const existingConversation = async (conversationId) => {
  const reference = db.collection("conversations").doc(conversationId);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data().type !== "support") {
    throw notFound("Support conversation not found.");
  }
  return { reference, conversation: snapshot.data() };
};

router.get("/conversations", async (request, response, next) => {
  try {
    const snapshot = await db.collection("conversations").limit(200).get();
    const records = snapshot.docs
      .map((document) => document.data())
      .filter((record) => record.type === "support")
      .filter((record) =>
        request.query.flagged !== "true" || record.flagged === true)
      .sort((a, b) =>
        String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
    return response.json({ data: records });
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
    const { reference, conversation } = await existingConversation(
      request.params.conversationId,
    );
    const messageReference = reference.collection("messages").doc();
    const message = createMessage({
      messageId: messageReference.id,
      conversationId: conversation.conversationId,
      sender: {
        uid: request.user.uid,
        role: "admin",
        name: request.user.name || request.user.email || "SwiftOpsBD Admin",
      },
      body: request.body.body,
    });
    const notificationReference = db.collection("notifications").doc();
    const now = message.createdAt;
    const batch = db.batch();
    batch.set(messageReference, message);
    batch.set(reference, {
      lastMessage: {
        body: message.body,
        senderId: message.senderId,
        senderName: message.senderName,
      },
      lastMessageAt: now,
      updatedAt: now,
    }, { merge: true });
    batch.set(notificationReference, createMessageNotification({
      notificationId: notificationReference.id,
      conversation,
      message,
      recipientId: conversation.ownerId,
      now,
    }));
    await batch.commit();
    return response.status(201).json({ data: message });
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
    const { reference } = await existingConversation(
      request.params.conversationId,
    );
    const snapshot = await reference.collection("messages").limit(300).get();
    const records = snapshot.docs
      .map((document) => document.data())
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return response.json({ data: records });
  } catch (error) {
    return next(error);
  }
});

router.patch("/conversations/:conversationId/flag", async (
  request,
  response,
  next,
) => {
  try {
    const { reference, conversation } = await existingConversation(
      request.params.conversationId,
    );
    const now = new Date().toISOString();
    const update = {
      flagged: request.body.flagged !== false,
      flagReason: String(request.body.reason || "").trim().slice(0, 500),
      flaggedBy: request.user.uid,
      flaggedAt: now,
      updatedAt: now,
    };
    await reference.set(update, { merge: true });
    return response.json({ data: { ...conversation, ...update } });
  } catch (error) {
    return next(error);
  }
});

router.patch("/conversations/:conversationId/support", async (
  request,
  response,
  next,
) => {
  try {
    const { reference, conversation } = await existingConversation(
      request.params.conversationId,
    );
    const now = new Date().toISOString();
    const update = {
      supportStatus: "assigned",
      assignedAdminId: request.body.adminId || request.user.uid,
      assignedBy: request.user.uid,
      assignedAt: now,
      updatedAt: now,
    };
    await reference.set(update, { merge: true });
    return response.json({ data: { ...conversation, ...update } });
  } catch (error) {
    return next(error);
  }
});

export default router;
