const express = require("express");
const router = express.Router();
const IngredientLog = require("../models/IngredientLog");
const Alert = require("../models/Alert");
const Device = require("../models/Device");
const IngredientStatus = require("../models/IngredientStatus");
const NFCTag = require("../models/NFCTag");
const AuditLog = require("../models/AuditLog");
const auth = require("../middleware/auth");

// Export all user data
router.get("/export", auth, async (req, res) => {
	try {
		const logs = await IngredientLog.find({ user: req.user._id }).populate({
			path: "device",
			select: "name rackId",
		});
		const alerts = await Alert.find({ userId: req.user._id }).populate({
			path: "device",
			select: "name rackId",
		});
		const devices = await Device.find({ owner: req.user._id });
		const status = await IngredientStatus.find({ user: req.user._id });
		const tags = await NFCTag.find({ createdBy: req.user._id });
		const formattedLogs = logs.map((log) => ({
			_id: log._id,
			ingredient: log.ingredient,
			device: log.device
				? {
						_id: log.device._id,
						name: log.device.name,
						rackId: log.device.rackId,
				  }
				: null,
			slotId: log.slotId,
			weight: log.weight,
			status: log.status,
			timestamp: log.timestamp ? log.timestamp.toISOString() : null,
		}));
		const formattedAlerts = alerts.map((alert) => ({
			_id: alert._id,
			type: alert.type,
			ingredient: alert.ingredient,
			device: alert.device
				? {
						_id: alert.device._id,
						name: alert.device.name,
						rackId: alert.device.rackId,
				  }
				: null,
			slotId: alert.slotId,
			acknowledged: alert.acknowledged,
			createdAt: alert.createdAt ? alert.createdAt.toISOString() : null,
		}));
		res.json({
			logs: formattedLogs,
			alerts: formattedAlerts,
			devices,
			status,
			tags,
		});
		await AuditLog.create({
			user: req.user._id,
			action: "user_data_exported",
			details: {},
			timestamp: new Date(),
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Delete all user data
router.delete("/delete", auth, async (req, res) => {
	try {
		await IngredientLog.deleteMany({ user: req.user._id });
		await Alert.deleteMany({ userId: req.user._id });
		await Device.deleteMany({ owner: req.user._id });
		await IngredientStatus.deleteMany({ user: req.user._id });
		await NFCTag.deleteMany({ createdBy: req.user._id });
		await AuditLog.create({
			user: req.user._id,
			action: "user_data_deleted",
			details: {},
			timestamp: new Date(),
		});
		res.json({ message: "All user data deleted" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

module.exports = router;
