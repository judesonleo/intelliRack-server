const express = require("express");
const router = express.Router();
const Alert = require("../models/Alert");
const auth = require("../middleware/auth");

// List all alerts for the logged-in user
router.get("/", auth, async (req, res) => {
	try {
		const { status, limit = 50, sort = "newest" } = req.query;

		let query = { userId: req.user._id };

		// Filter by status
		if (status === "active") {
			query.acknowledged = false;
		} else if (status === "acknowledged") {
			query.acknowledged = true;
		}

		// Build sort object
		let sortObj = {};
		if (sort === "newest") {
			sortObj.createdAt = -1;
		} else if (sort === "oldest") {
			sortObj.createdAt = 1;
		} else if (sort === "priority") {
			sortObj.type = 1; // EMPTY first, then LOW_STOCK, etc.
		}

		const alerts = await Alert.find(query)
			.populate("device", "name rackId")
			.sort(sortObj)
			.limit(parseInt(limit));

		res.json(alerts);
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

// Delete all acknowledged alerts
router.delete("/clear-acknowledged", auth, async (req, res) => {
	try {
		const result = await Alert.deleteMany({
			userId: req.user._id,
			acknowledged: true,
		});

		res.json({
			message: `${result.deletedCount} acknowledged alerts deleted`,
			deletedCount: result.deletedCount,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

module.exports = router;
