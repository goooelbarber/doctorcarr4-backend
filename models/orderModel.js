import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    // =========================
    // 👤 User
    // =========================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // =========================
    // 🛠️ Service
    // =========================
    serviceName: {
      type: String,
      required: true,
    },

    serviceType: {
      type: String,
      required: true,
    },

    // =========================
    // 📍 Location
    // =========================
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },

    // =========================
    // 🔧 Technician (snapshot)
    // =========================
    technician: {
      techId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Technician",
        default: null,
      },
      techName: { type: String, default: null },
      phone: { type: String, default: null },
      location: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },

    // =========================
    // 💬 Chat
    // =========================
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportChat",
      default: null,
    },

    // =========================
    // 💰 Price
    // =========================
    price: {
      type: Number,
      default: 0,
    },

    // =========================
    // 📊 Status
    // =========================
    status: {
      type: String,
      enum: [
        // legacy/basic
        "pending",
        "accepted",
        "on_the_way",
        "arrived",
        "working",
        "completed",

        // ✅ Uber-like flow used in your server/routes
        "searching",
        "contacting",
        "assigned",
        "in_progress",
        "timeout",

        // ✅ unify spelling (prefer "canceled")
        "canceled",
        "cancelled", // keep for backward compatibility

        // ✅ failure state if you use it
        "failed",
      ],
      default: "pending",
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    // =========================
    // 💳 Payment
    // =========================
    payment: {
      method: { type: String, default: "cash" },
      isPaid: { type: Boolean, default: false },
      transactionId: { type: String, default: null },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Order", orderSchema);
