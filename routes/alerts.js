const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Alert = require("../models/Alert");
const auth = require("../middleware/auth");

// List all alerts for the logged-in user
router.get("/", auth, async (req, res) => {
	try {
		const { status, limit = 25, page = 1, sort = "newest" } = req.query;
		let query = { userId: req.user._id };
		if (status === "active") {
			query.acknowledged = false;
		} else if (status === "acknowledged") {
			query.acknowledged = true;
		}
		let sortObj = {};
		if (sort === "newest") {
			sortObj.createdAt = -1;
		} else if (sort === "oldest") {
			sortObj.createdAt = 1;
		} else if (sort === "priority") {
			sortObj.type = 1;
		}

		const skip = (parseInt(page) - 1) * parseInt(limit);
		const total = await Alert.countDocuments(query);

		const alerts = await Alert.find(query)
			.populate({ path: "device", select: "name rackId" })
			.sort(sortObj)
			.skip(skip)
			.limit(parseInt(limit));
		const formatted = alerts.map((alert) => ({
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
			alerts: formatted,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / parseInt(limit)),
			},
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Acknowledge an alert
router.patch("/:alertId/acknowledge", auth, async (req, res) => {
	try {
		const alert = await Alert.findOneAndUpdate(
			{ _id: req.params.alertId, userId: req.user._id },
			{ acknowledged: true, acknowledgedAt: new Date() },
			{ new: true }
		);

		if (!alert) {
			return res.status(404).json({ error: "Alert not found" });
		}

		res.json(alert);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Acknowledge all alerts
router.patch("/acknowledge-all", auth, async (req, res) => {
	try {
		const result = await Alert.updateMany(
			{ userId: req.user._id, acknowledged: false },
			{ acknowledged: true, acknowledgedAt: new Date() }
		);

		res.json({
			message: `${result.modifiedCount} alerts acknowledged`,
			acknowledgedCount: result.modifiedCount,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get alert statistics
router.get("/stats", auth, async (req, res) => {
	try {
		const stats = await Alert.aggregate([
			{ $match: { userId: req.user._id } },
			{
				$group: {
					_id: null,
					total: { $sum: 1 },
					acknowledged: { $sum: { $cond: ["$acknowledged", 1, 0] } },
					active: { $sum: { $cond: ["$acknowledged", 0, 1] } },
					empty: { $sum: { $cond: [{ $eq: ["$type", "EMPTY"] }, 1, 0] } },
					lowStock: {
						$sum: { $cond: [{ $eq: ["$type", "LOW_STOCK"] }, 1, 0] },
					},
					overweight: {
						$sum: { $cond: [{ $eq: ["$type", "OVERWEIGHT"] }, 1, 0] },
					},
				},
			},
		]);

		res.json(
			stats[0] || {
				total: 0,
				acknowledged: 0,
				active: 0,
				empty: 0,
				lowStock: 0,
				overweight: 0,
			}
		);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Delete all acknowledged alerts
router.delete("/clearacknowledged", auth, async (req, res) => {
	try {
		console.log("[clear-acknowledged] req.user:", req.user);
		console.log("[clear-acknowledged] req.user._id:", req.user._id);
		console.log("[clear-acknowledged] req.user._id type:", typeof req.user._id);

		// Validate user ID
		if (!req.user._id) {
			return res.status(400).json({ error: "Invalid user ID" });
		}

		// First, get the count of acknowledged alerts to validate
		const acknowledgedCount = await Alert.countDocuments({
			userId: req.user._id,
			acknowledged: true,
		});

		console.log(
			"[clear-acknowledged] Found acknowledged alerts:",
			acknowledgedCount
		);

		if (acknowledgedCount === 0) {
			return res.json({
				message: "No acknowledged alerts to delete",
				deletedCount: 0,
			});
		}

		const result = await Alert.deleteMany({
			userId: req.user._id,
			acknowledged: true,
		});

		console.log("[clear-acknowledged] Result:", result);

		res.json({
			message: `${result.deletedCount} acknowledged alerts deleted`,
			deletedCount: result.deletedCount,
		});
	} catch (err) {
		console.error("[clear-acknowledged] Error:", err);
		res.status(500).json({ error: err.message });
	}
});

// Delete an alert
router.delete("/:alertId", auth, async (req, res) => {
	try {
		const alert = await Alert.findOneAndDelete({
			_id: req.params.alertId,
			userId: req.user._id,
		});

		if (!alert) {
			return res.status(404).json({ error: "Alert not found" });
		}

		res.json({ message: "Alert deleted successfully" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

module.exports = router;
