const express = require("express");
const router = express.Router();
const IngredientLog = require("../models/IngredientLog");
const Alert = require("../models/Alert");
const auth = require("../middleware/auth");

// Get all unique ingredient names for the authenticated user
router.get("/unique", auth, async (req, res) => {
	try {
		const ingredients = await IngredientLog.distinct("ingredient", {
			user: req.user._id,
		});
		res.json(ingredients);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get all logs for a specific ingredient for the authenticated user
router.get("/logs/:ingredient", auth, async (req, res) => {
	try {
		const logs = await IngredientLog.find({
			user: req.user._id,
			ingredient: req.params.ingredient,
		})
			.populate({ path: "device", select: "name rackId" })
			.sort({ timestamp: -1 });
		const formatted = logs.map((log) => ({
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
		res.json(formatted);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Advanced analytics endpoints

// 1. Daily usage rates for an ingredient
router.get("/usage/:ingredient", auth, async (req, res) => {
	try {
		const logs = await IngredientLog.find({
			user: req.user._id,
			ingredient: req.params.ingredient,
		}).sort({ timestamp: 1 });

		// Calculate daily usage (difference in weight per day)
		const usageByDay = {};
		let prevWeight = null;
		logs.forEach((log) => {
			const day = log.timestamp.toISOString().slice(0, 10);
			if (prevWeight !== null && log.weight < prevWeight) {
				const used = prevWeight - log.weight;
				usageByDay[day] = (usageByDay[day] || 0) + used;
			}
			prevWeight = log.weight;
		});
		const result = Object.entries(usageByDay).map(([date, totalUsed]) => ({
			date,
			totalUsed,
		}));
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// 2. Predict days left until ingredient runs out
router.get("/prediction/:ingredient", auth, async (req, res) => {
	try {
		const logs = await IngredientLog.find({
			user: req.user._id,
			ingredient: req.params.ingredient,
		}).sort({ timestamp: 1 });
		if (logs.length < 2)
			return res.json({ prediction: null, message: "Not enough data" });

		// Calculate average daily usage over the last 7 days (or all days if less)
		const usageByDay = {};
		let prevWeight = null;
		logs.forEach((log) => {
			const day = log.timestamp.toISOString().slice(0, 10);
			if (prevWeight !== null && log.weight < prevWeight) {
				const used = prevWeight - log.weight;
				usageByDay[day] = (usageByDay[day] || 0) + used;
			}
			prevWeight = log.weight;
		});
		const usageArray = Object.values(usageByDay);
		const days = usageArray.length;
		const avgDailyUsage =
			days > 0
				? usageArray.slice(-7).reduce((a, b) => a + b, 0) / Math.min(days, 7)
				: 0;
		const latestWeight = logs[logs.length - 1].weight;
		const prediction =
			avgDailyUsage > 0
				? Math.max(0, Math.round(latestWeight / avgDailyUsage))
				: null;

		// Depletion alert logic
		if (prediction !== null && prediction <= 3) {
			const Alert = require("../models/Alert");
			const existing = await Alert.findOne({
				userId: req.user._id,
				device: logs[logs.length - 1].device,
				ingredient: req.params.ingredient,
				type: "DEPLETION",
				acknowledged: false,
			});
			if (!existing) {
				await Alert.create({
					userId: req.user._id,
					device: logs[logs.length - 1].device,
					ingredient: req.params.ingredient,
					type: "DEPLETION",
					acknowledged: false,
					createdAt: new Date(),
				});
				// Webhook
				const User = require("../models/User");
				const user = await User.findById(req.user._id);
				if (user && user.webhookUrl) {
					try {
						await fetch(user.webhookUrl, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								alertType: "DEPLETION",
								ingredient: req.params.ingredient,
								prediction,
								user: req.user._id,
							}),
						});
					} catch {}
				}
				// Audit log
				const AuditLog = require("../models/AuditLog");
				await AuditLog.create({
					user: req.user._id,
					action: "depletion_alert_created",
					details: { ingredient: req.params.ingredient, prediction },
				});
			}
		}

		res.json({ avgDailyUsage, latestWeight, prediction, unit: "days" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// 3. Anomaly detection: logs with unusually large changes
router.get("/anomalies/:ingredient", auth, async (req, res) => {
	try {
		const logs = await IngredientLog.find({
			user: req.user._id,
			ingredient: req.params.ingredient,
		})
			.populate({ path: "device", select: "name rackId" })
			.sort({ timestamp: 1 });
		if (logs.length < 2) return res.json([]);

		// Calculate changes
		let prevWeight = logs[0].weight;
		const changes = [];
		for (let i = 1; i < logs.length; i++) {
			const change = logs[i].weight - prevWeight;
			changes.push({ log: logs[i], change });
			prevWeight = logs[i].weight;
		}
		// Calculate standard deviation of changes
		const changeVals = changes.map((c) => c.change);
		const mean = changeVals.reduce((a, b) => a + b, 0) / changeVals.length;
		const std = Math.sqrt(
			changeVals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
				changeVals.length
		);
		// Flag anomalies as changes > 2*std from mean
		const anomalies = changes
			.filter((c) => Math.abs(c.change - mean) > 2 * std)
			.map((c) => c.log);
		const formatted = anomalies.map((log) => ({
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

		// Integrate with alerts: create alert for each new anomaly
		for (const log of formatted) {
			// Check for existing unacknowledged anomaly alert within ±10 minutes
			const minTime = new Date(log.timestamp.getTime() - 10 * 60000);
			const maxTime = new Date(log.timestamp.getTime() + 10 * 60000);
			const existing = await Alert.findOne({
				userId: req.user._id,
				device: log.device._id,
				slotId: log.slotId,
				ingredient: log.ingredient,
				type: "ANOMALY",
				acknowledged: false,
				createdAt: { $gte: minTime, $lte: maxTime },
			});
			if (!existing) {
				await Alert.create({
					userId: req.user._id,
					device: log.device._id,
					slotId: log.slotId,
					ingredient: log.ingredient,
					type: "ANOMALY",
					acknowledged: false,
					createdAt: log.timestamp,
				});
				console.log(
					"Anomaly alert created:",
					log.ingredient,
					log.slotId,
					log.timestamp
				);
			} else {
				console.log(
					"Duplicate or unacknowledged anomaly alert skipped:",
					log.ingredient,
					log.slotId,
					log.timestamp
				);
			}
		}

		res.json(formatted);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Weekly and monthly usage trends
router.get("/usage-trends/:ingredient", auth, async (req, res) => {
	try {
		const logs = await IngredientLog.find({
			user: req.user._id,
			ingredient: req.params.ingredient,
		}).sort({ timestamp: 1 });
		const weekly = {};
		const monthly = {};
		logs.forEach((log) => {
			const week = `${log.timestamp.getFullYear()}-W${Math.ceil(
				(log.timestamp.getDate() + 6 - log.timestamp.getDay()) / 7
			)}`;
			const month = `${log.timestamp.getFullYear()}-${(
				log.timestamp.getMonth() + 1
			)
				.toString()
				.padStart(2, "0")}`;
			if (!weekly[week]) weekly[week] = 0;
			if (!monthly[month]) monthly[month] = 0;
			weekly[week] += log.weight;
			monthly[month] += log.weight;
		});
		res.json({ weekly, monthly });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Basic shopping list recommendation (top 3 most used ingredients in last 30 days)
router.get("/recommendations", auth, async (req, res) => {
	try {
		const since = new Date();
		since.setDate(since.getDate() - 30);
		const logs = await IngredientLog.aggregate([
			{ $match: { user: req.user._id, timestamp: { $gte: since } } },
			{ $group: { _id: "$ingredient", total: { $sum: "$weight" } } },
			{ $sort: { total: -1 } },
			{ $limit: 3 },
		]);
		res.json(logs.map((l) => l._id));
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Ingredient substitution suggestions
router.get("/substitutions/:ingredient", auth, async (req, res) => {
	try {
		// Find logs where the given ingredient was low/empty, and what was used next
		const logs = await IngredientLog.find({
			user: req.user._id,
			ingredient: req.params.ingredient,
			status: { $in: ["LOW", "EMPTY"] },
		}).sort({ timestamp: 1 });
		const nextIngredients = [];
		for (let i = 0; i < logs.length - 1; i++) {
			const next = await IngredientLog.findOne({
				user: req.user._id,
				slotId: logs[i].slotId,
				timestamp: { $gt: logs[i].timestamp },
			}).sort({ timestamp: 1 });
			if (next && next.ingredient !== req.params.ingredient) {
				nextIngredients.push(next.ingredient);
			}
		}
		const unique = [...new Set(nextIngredients)];
		res.json(unique);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

module.exports = router;
