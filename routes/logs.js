const express = require("express");
const router = express.Router();
const IngredientLog = require("../models/IngredientLog");
const auth = require("../middleware/auth");

// Get recent logs for the logged-in user's devices
router.get("/", auth, async (req, res) => {
	try {
		const {
			device,
			status,
			ingredient,
			limit = 100,
			sort = "newest",
			startDate,
			endDate,
			search,
		} = req.query;

		// Build query
		let query = {};

		// Filter by device
		if (device) {
			query.device = device;
		}

		// Filter by status
		if (status && status !== "all") {
			query.status = status;
		}

		// Filter by ingredient
		if (ingredient) {
			query.ingredient = { $regex: ingredient, $options: "i" };
		}

		// Filter by date range
		if (startDate || endDate) {
			query.timestamp = {};
			if (startDate) query.timestamp.$gte = new Date(startDate);
			if (endDate) query.timestamp.$lte = new Date(endDate);
		}

		// Search functionality
		if (search) {
			query.$or = [
				{ ingredient: { $regex: search, $options: "i" } },
				{ tagUID: { $regex: search, $options: "i" } },
			];
		}

		// Build sort object
		let sortObj = {};
		if (sort === "newest") {
			sortObj.timestamp = -1;
		} else if (sort === "oldest") {
			sortObj.timestamp = 1;
		} else if (sort === "weight") {
			sortObj.weight = -1;
		}

		const logs = await IngredientLog.find(query)
			.populate({
				path: "device",
				match: { owner: req.user._id },
				select: "name rackId",
			})
			.sort(sortObj)
			.limit(parseInt(limit));
		const filteredLogs = logs.filter((log) => log.device);
		const formatted = filteredLogs.map((log) => ({
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

// Get log statistics
router.get("/stats", auth, async (req, res) => {
	try {
		const { startDate, endDate } = req.query;

		let matchQuery = {};

		// Filter by date range
		if (startDate || endDate) {
			matchQuery.timestamp = {};
			if (startDate) matchQuery.timestamp.$gte = new Date(startDate);
			if (endDate) matchQuery.timestamp.$lte = new Date(endDate);
		}

		const stats = await IngredientLog.aggregate([
			{ $match: matchQuery },
			{
				$lookup: {
					from: "devices",
					localField: "device",
					foreignField: "_id",
					as: "deviceInfo",
				},
			},
			{ $unwind: "$deviceInfo" },
			{ $match: { "deviceInfo.owner": req.user._id } },
			{
				$group: {
					_id: null,
					totalLogs: { $sum: 1 },
					totalWeight: { $sum: { $ifNull: ["$weight", 0] } },
					avgWeight: { $avg: { $ifNull: ["$weight", 0] } },
					goodStock: { $sum: { $cond: [{ $eq: ["$status", "GOOD"] }, 1, 0] } },
					lowStock: {
						$sum: { $cond: [{ $in: ["$status", ["LOW", "VLOW"]] }, 1, 0] },
					},
					empty: { $sum: { $cond: [{ $eq: ["$status", "EMPTY"] }, 1, 0] } },
					uniqueIngredients: { $addToSet: "$ingredient" },
					uniqueDevices: { $addToSet: "$device" },
				},
			},
			{
				$project: {
					totalLogs: 1,
					totalWeight: 1,
					avgWeight: 1,
					goodStock: 1,
					lowStock: 1,
					empty: 1,
					uniqueIngredientsCount: { $size: "$uniqueIngredients" },
					uniqueDevicesCount: { $size: "$uniqueDevices" },
				},
			},
		]);

		res.json(
			stats[0] || {
				totalLogs: 0,
				totalWeight: 0,
				avgWeight: 0,
				goodStock: 0,
				lowStock: 0,
				empty: 0,
				uniqueIngredientsCount: 0,
				uniqueDevicesCount: 0,
			}
		);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Export logs as CSV
router.get("/export", auth, async (req, res) => {
	try {
		const { format = "csv", startDate, endDate } = req.query;

		let query = {};

		// Filter by date range
		if (startDate || endDate) {
			query.timestamp = {};
			if (startDate) query.timestamp.$gte = new Date(startDate);
			if (endDate) query.timestamp.$lte = new Date(endDate);
		}

		const logs = await IngredientLog.find(query)
			.populate({
				path: "device",
				match: { owner: req.user._id },
				select: "name rackId",
			})
			.sort({ timestamp: -1 });

		// Filter out logs for devices not owned by the user
		const filteredLogs = logs.filter((log) => log.device);

		if (format === "csv") {
			const csvContent = [
				"Timestamp,Device,Ingredient,Weight,Status,Tag UID,Slot ID",
				...filteredLogs.map(
					(log) =>
						`${new Date(log.timestamp).toISOString()},"${
							log.device?.name || "Unknown"
						}","${log.ingredient || "Unknown"}",${log.weight || 0},"${
							log.status || "Unknown"
						}","${log.tagUID || ""}","${log.slotId || ""}"`
				),
			].join("\n");

			res.setHeader("Content-Type", "text/csv");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="intellirack-logs-${
					new Date().toISOString().split("T")[0]
				}.csv"`
			);
			res.send(csvContent);
		} else {
			res.json(filteredLogs);
		}
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get logs by device
router.get("/device/:deviceId", auth, async (req, res) => {
	try {
		const { limit = 50, sort = "newest" } = req.query;

		// Verify device ownership
		const Device = require("../models/Device");
		const device = await Device.findOne({
			_id: req.params.deviceId,
			owner: req.user._id,
		});

		if (!device) {
			return res.status(404).json({ error: "Device not found" });
		}

		// Build sort object
		let sortObj = {};
		if (sort === "newest") {
			sortObj.timestamp = -1;
		} else if (sort === "oldest") {
			sortObj.timestamp = 1;
		} else if (sort === "weight") {
			sortObj.weight = -1;
		}

		const logs = await IngredientLog.find({ device: req.params.deviceId })
			.sort(sortObj)
			.limit(parseInt(limit));

		res.json(logs);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Delete old logs (cleanup)
router.delete("/cleanup", auth, async (req, res) => {
	try {
		const { days = 30 } = req.query;
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

		// Get user's devices
		const Device = require("../models/Device");
		const userDevices = await Device.find({ owner: req.user._id }).select(
			"_id"
		);
		const deviceIds = userDevices.map((device) => device._id);

		const result = await IngredientLog.deleteMany({
			device: { $in: deviceIds },
			timestamp: { $lt: cutoffDate },
		});

		res.json({
			message: `${result.deletedCount} old logs deleted`,
			deletedCount: result.deletedCount,
			cutoffDate: cutoffDate,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

module.exports = router;
