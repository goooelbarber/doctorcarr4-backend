// PATH: backend/socket/orderSocket.js

import Order from "../models/orderModel.js";
import SupportChat from "../models/supportChat.model.js";

export function attachOrderSocket(io) {
  io.on("connection", (socket) => {
    console.log("🟣 Order socket connected:", socket.id);

    // =========================
    // ✅ Technician Accept Order (SAFE)
    // =========================
    socket.on("order:accept", async ({ orderId, technicianId }) => {
      if (!orderId || !technicianId) return;

      try {
        // 🔒 atomic update (prevent double accept)
        const order = await Order.findOneAndUpdate(
          { _id: orderId, status: "pending" },
          {
            status: "accepted",
            technician: { id: technicianId },
          },
          { new: true }
        );

        if (!order) {
          socket.emit("order:accept:failed", {
            orderId,
            reason: "Order already taken",
          });
          return;
        }

        // =========================
        // 💬 Get or Create Support Chat
        // =========================
        let chat = await SupportChat.findOne({
          user: order.user,
          technician: technicianId,
          status: { $ne: "closed" },
        });

        if (!chat) {
          chat = await SupportChat.create({
            user: order.user,
            technician: technicianId,
            order: order._id,
            status: "assigned",
            lastMessageAt: new Date(),
          });
        }

        // =========================
        // 📢 Notify technician (winner)
        // =========================
        socket.emit("order:accepted", {
          ...order.toObject(),
          chatId: chat._id,
        });

        // =========================
        // 📢 Notify user
        // =========================
        const userId =
          order.user?._id || order.user || order.customer;

        if (userId) {
          io.to(`user:${userId}`).emit("order:accepted", {
            ...order.toObject(),
            chatId: chat._id,
          });
        }

        // =========================
        // 📢 Notify others (optional)
        // =========================
        socket.to("technicians").emit("order:taken", {
          orderId,
          technicianId,
        });

        console.log(
          `✅ Order ${orderId} accepted by technician ${technicianId}`
        );
      } catch (error) {
        console.error("❌ order:accept error:", error.message);
        socket.emit("order:accept:failed", {
          orderId,
          reason: "Server error",
        });
      }
    });

    // =========================
    // ❌ Technician Reject Order
    // =========================
    socket.on("order:reject", ({ orderId }) => {
      if (!orderId) return;

      // مجرد إشعار (الطلب يفضل pending)
      socket.emit("order:rejected:ok", { orderId });

      console.log(`❌ Order rejected: ${orderId}`);
    });
  });
}
