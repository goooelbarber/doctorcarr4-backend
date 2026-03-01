import express from "express";
import Order from "../models/orderModel.js";
import { onlineTechnicians } from "../server.js";

const router = express.Router();

/**
 * ======================================================
 * 🟢 Create Order (REAL - Uber Style)
 * ======================================================
 */
router.post("/", async (req, res) => {
  try {
    const { userId, serviceName, serviceType, location } = req.body;

    // ===============================
    // Validation
    // ===============================
    if (
      !userId ||
      !serviceName ||
      !serviceType ||
      !location ||
      location.lat == null ||
      location.lng == null
    ) {
      return res.status(400).json({
        success: false,
        message: "⚠️ بيانات ناقصة",
      });
    }

    const io = req.io;

    // ===============================
    // Create Order
    // ===============================
    const order = await Order.create({
      user: userId,
      serviceName,
      serviceType,
      location: {
        lat: location.lat,
        lng: location.lng,
      },
      status: "searching", // Uber-like
    });

    // payload للمستخدم
    const searchingPayload = {
      orderId: String(order._id),
      status: "searching",
      message: "جارٍ البحث عن أقرب فني…",
    };

    if (io) {
      // للمستخدم صاحب الطلب فقط
      io.to(`user:${String(userId)}`).emit("orderStatusUpdated", searchingPayload);

      // كمان لروم الطلب (لو الشاشة عاملة joinOrderRoom)
      io.to(String(order._id)).emit("orderStatusUpdated", searchingPayload);
    }

    // ===============================
    // Prepare technician payload (خفيف وعملي)
    // ===============================
    const techPayload = {
      _id: String(order._id),
      user: String(userId),
      serviceName,
      serviceType,
      location: { lat: location.lat, lng: location.lng },
      status: "searching",
      createdAt: order.createdAt || new Date().toISOString(),
    };

    // ===============================
    // 🔥 Send to Online Technicians
    // ===============================
    let sentCount = 0;

    if (io) {
      // ✅ Backup مهم جدًا: ابعت على room "technicians"
      // أي فني online في السيرفر بيتعمله join("technicians")
      io.to("technicians").emit("order:new", techPayload);
      console.log(`📡 order:new broadcast → room:technicians (backup)`);

      // ✅ كمان ابعت individual sockets (لو map شغالة)
      if (onlineTechnicians && onlineTechnicians.size > 0) {
        for (const [techId, socketId] of onlineTechnicians.entries()) {
          if (!socketId) continue;
          io.to(socketId).emit("order:new", techPayload);
          sentCount++;
          console.log(`📡 order:new → tech:${techId} socket:${socketId}`);
        }
      }
    }

    // ===============================
    // Update UI status to contacting
    // ===============================
    const contactingPayload = {
      orderId: String(order._id),
      status: "contacting",
      message:
        sentCount > 0
          ? `جاري التواصل مع الفنيين القريبين…`
          : `لا يوجد فنيين متصلين الآن، جاري المحاولة…`,
    };

    // خزّن الحالة في الداتابيز (اختياري لكنه مفيد)
    order.status = "contacting";
    await order.save();

    if (io) {
      io.to(`user:${String(userId)}`).emit("orderStatusUpdated", contactingPayload);
      io.to(String(order._id)).emit("orderStatusUpdated", contactingPayload);
    }

    console.log(`✅ Order ${order._id} dispatched (sentCount=${sentCount})`);

    return res.status(201).json({
      success: true,
      message: "تم إرسال الطلب بنجاح",
      order,
    });
  } catch (error) {
    console.error("❌ createOrder error:", error);
    return res.status(500).json({
      success: false,
      message: "خطأ في إنشاء الطلب",
    });
  }
});

export default router;
