const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		rackId: { type: String, required: true, unique: true },
		location: String,
		owner: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		// Device status tracking
		isOnline: { type: Boolean, default: false },
		lastSeen: { type: Date, default: Date.now },
		lastWeight: { type: Number, default: 0 },
		lastStatus: { type: String, default: "UNKNOWN" },
		firmwareVersion: { type: String, default: "v2.0" },
		ipAddress: String,
		mqttConnected: { type: Boolean, default: false },
		// Configuration
		calibrationFactor: { type: Number, default: 204.99 },
		weightThresholds: {
			min: { type: Number, default: 5.0 },
			low: { type: Number, default: 100.0 },
			moderate: { type: Number, default: 200.0 },
			good: { type: Number, default: 500.0 },
			max: { type: Number, default: 5000.0 },
		},
		settings: {
			ledEnabled: { type: Boolean, default: true },
			soundEnabled: { type: Boolean, default: false },
			autoTare: { type: Boolean, default: false },
			mqttPublishInterval: { type: Number, default: 5000 },
		},
	},
	{ timestamps: true }
);

// Index for efficient queries
deviceSchema.index({ owner: 1, isOnline: 1 });
deviceSchema.index({ rackId: 1 });

module.exports = mongoose.model("Device", deviceSchema);
