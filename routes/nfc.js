const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const NFCTag = require("../models/NFCTag");
const Device = require("../models/Device");
const auth = require("../middleware/auth");

// Get all NFC tags
router.get("/", auth, async (req, res) => {
	try {
		const tags = await NFCTag.find({ createdBy: req.user.id })
			.populate("deviceId", "name rackId")
			.sort({ createdAt: -1 });

		res.json(tags);
	} catch (error) {
		console.error("Error fetching NFC tags:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// Get NFC tag by ID
router.get("/:id", auth, async (req, res) => {
	try {
		const tag = await NFCTag.findOne({
			_id: req.params.id,
			createdBy: req.user.id,
		}).populate("deviceId", "name rackId");

		if (!tag) {
			return res.status(404).json({ message: "NFC tag not found" });
		}

		res.json(tag);
	} catch (error) {
		console.error("Error fetching NFC tag:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// Get NFC tag by UID
router.get("/uid/:uid", auth, async (req, res) => {
	try {
		const tag = await NFCTag.findByUID(req.params.uid).populate(
			"deviceId",
			"name rackId"
		);

		if (!tag) {
			return res.status(404).json({ message: "NFC tag not found" });
		}

		// Check if user owns this tag
		if (tag.createdBy.toString() !== req.user.id) {
			return res.status(403).json({ message: "Access denied" });
		}

		res.json(tag);
	} catch (error) {
		console.error("Error fetching NFC tag by UID:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// Create new NFC tag
router.post("/", auth, async (req, res) => {
	try {
		const { uid, ingredient, deviceId, slotId, metadata } = req.body;

		// Validate required fields
		if (!uid || !ingredient || !deviceId || !slotId) {
			return res.status(400).json({
				message: "UID, ingredient, deviceId, and slotId are required",
			});
		}

		// Check if device exists and user owns it
		const device = await Device.findOne({
			_id: deviceId,
			userId: req.user.id,
		});

		if (!device) {
			return res.status(404).json({ message: "Device not found" });
		}

		// Check if tag already exists
		const existingTag = await NFCTag.findByUID(uid);
		if (existingTag) {
			return res
				.status(400)
				.json({ message: "NFC tag with this UID already exists" });
		}

		// Check if slot is already assigned to another tag
		const existingSlotTag = await NFCTag.findByDeviceAndSlot(deviceId, slotId);
		if (existingSlotTag) {
			return res
				.status(400)
				.json({ message: "Slot is already assigned to another NFC tag" });
		}

		// Create new tag
		const tag = new NFCTag({
			uid: uid.toUpperCase(),
			ingredient,
			deviceId,
			slotId,
			metadata: metadata || {},
			createdBy: req.user.id,
		});

		await tag.save();

		// Populate device info for response
		await tag.populate("deviceId", "name rackId");

		res.status(201).json(tag);
	} catch (error) {
		console.error("Error creating NFC tag:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// Update NFC tag
router.put("/:id", auth, async (req, res) => {
	try {
		const { ingredient, status, metadata } = req.body;

		const tag = await NFCTag.findOne({
			_id: req.params.id,
			createdBy: req.user.id,
		});

		if (!tag) {
			return res.status(404).json({ message: "NFC tag not found" });
		}

		// Update fields
		if (ingredient !== undefined) tag.ingredient = ingredient;
		if (status !== undefined) tag.status = status;
		if (metadata !== undefined) tag.metadata = metadata;

		await tag.save();
		await tag.populate("deviceId", "name rackId");

		res.json(tag);
	} catch (error) {
		console.error("Error updating NFC tag:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// Delete NFC tag
router.delete("/:id", auth, async (req, res) => {
	try {
		const tag = await NFCTag.findOneAndDelete({
			_id: req.params.id,
			createdBy: req.user.id,
		});

		if (!tag) {
			return res.status(404).json({ message: "NFC tag not found" });
		}

		res.json({ message: "NFC tag deleted successfully" });
	} catch (error) {
		console.error("Error deleting NFC tag:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// Bulk operations
router.post("/bulk", auth, async (req, res) => {
	try {
		const { operation, tagIds } = req.body;

		if (!operation || !tagIds || !Array.isArray(tagIds)) {
			return res
				.status(400)
				.json({ message: "Invalid bulk operation parameters" });
		}

		let result;

		switch (operation) {
			case "activate":
				result = await NFCTag.updateMany(
					{ _id: { $in: tagIds }, createdBy: req.user.id },
					{ status: "active" }
				);
				break;
			case "deactivate":
				result = await NFCTag.updateMany(
					{ _id: { $in: tagIds }, createdBy: req.user.id },
					{ status: "inactive" }
				);
				break;
			case "delete":
				result = await NFCTag.deleteMany({
					_id: { $in: tagIds },
					createdBy: req.user.id,
				});
				break;
			default:
				return res.status(400).json({ message: "Invalid operation" });
		}

		res.json({
			message: `Bulk operation '${operation}' completed`,
			modifiedCount: result.modifiedCount || result.deletedCount,
		});
	} catch (error) {
		console.error("Error performing bulk operation:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// NFC tag statistics
router.get("/stats/overview", auth, async (req, res) => {
	try {
		const stats = await NFCTag.aggregate([
			{ $match: { createdBy: mongoose.Types.ObjectId(req.user.id) } },
			{
				$group: {
					_id: null,
					totalTags: { $sum: 1 },
					activeTags: {
						$sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
					},
					inactiveTags: {
						$sum: { $cond: [{ $eq: ["$status", "inactive"] }, 1, 0] },
					},
					lostTags: {
						$sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] },
					},
					totalReads: { $sum: "$readCount" },
					totalWrites: { $sum: "$writeCount" },
				},
			},
		]);

		res.json(
			stats[0] || {
				totalTags: 0,
				activeTags: 0,
				inactiveTags: 0,
				lostTags: 0,
				totalReads: 0,
				totalWrites: 0,
			}
		);
	} catch (error) {
		console.error("Error fetching NFC stats:", error);
		res.status(500).json({ message: "Server error" });
	}
});

// Search NFC tags
router.get("/search/:query", auth, async (req, res) => {
	try {
		const query = req.params.query;
		const tags = await NFCTag.find({
			createdBy: req.user.id,
			$or: [
				{ ingredient: { $regex: query, $options: "i" } },
				{ uid: { $regex: query, $options: "i" } },
				{ slotId: { $regex: query, $options: "i" } },
			],
		}).populate("deviceId", "name rackId");

		res.json(tags);
	} catch (error) {
		console.error("Error searching NFC tags:", error);
		res.status(500).json({ message: "Server error" });
	}
});

module.exports = router;
