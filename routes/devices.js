const express = require("express");
const router = express.Router();
const Device = require("../models/Device");
const auth = require("../middleware/auth");
const User = require("../models/User");

// Register a new device
router.post("/register", auth, async (req, res) => {
	const { name, rackId, location, firmwareVersion } = req.body;
	try {
		// Check if device already exists
		const existingDevice = await Device.findOne({ rackId });
		if (existingDevice) {
			return res
				.status(400)
				.json({ error: "Device with this Rack ID already exists" });
		}

		const device = new Device({
			name,
			rackId,
			location,
			firmwareVersion: firmwareVersion || "v2.0",
			owner: req.user._id,
		});
		await device.save();
		await User.findByIdAndUpdate(req.user._id, {
			$push: { devices: device._id },
		});
		res.status(201).json(device);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
});

// List all devices for the logged-in user
router.get("/my", auth, async (req, res) => {
	try {
		const devices = await Device.find({ owner: req.user._id })
			.select("-__v")
			.sort({ createdAt: -1 });
		res.json(devices);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get device status (online/offline, last seen, etc.)
router.get("/status", auth, async (req, res) => {
	try {
		const devices = await Device.find({ owner: req.user._id })
			.select(
				"rackId name isOnline lastSeen lastWeight lastStatus ipAddress firmwareVersion"
			)
			.sort({ lastSeen: -1 });
		res.json(devices);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get a device by rackId
router.get("/:rackId", auth, async (req, res) => {
	try {
		const device = await Device.findOne({
			rackId: req.params.rackId,
			owner: req.user._id,
		});
		if (!device) return res.status(404).json({ error: "Device not found" });
		res.json(device);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Update device configuration
router.put("/:rackId/config", auth, async (req, res) => {
	try {
		const { weightThresholds, settings, calibrationFactor } = req.body;

		const updateData = {};
		if (weightThresholds) updateData.weightThresholds = weightThresholds;
		if (settings) updateData.settings = settings;
		if (calibrationFactor) updateData.calibrationFactor = calibrationFactor;

		const device = await Device.findOneAndUpdate(
			{ rackId: req.params.rackId, owner: req.user._id },
			updateData,
			{ new: true }
		);

		if (!device) return res.status(404).json({ error: "Device not found" });
		res.json(device);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Get device configuration
router.get("/:rackId/config", auth, async (req, res) => {
	try {
		const device = await Device.findOne({
			rackId: req.params.rackId,
			owner: req.user._id,
		}).select("weightThresholds settings calibrationFactor firmwareVersion");

		if (!device) return res.status(404).json({ error: "Device not found" });
		res.json(device);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Delete a device
router.delete("/:rackId", auth, async (req, res) => {
	try {
		const device = await Device.findOneAndDelete({
			rackId: req.params.rackId,
			owner: req.user._id,
		});

		if (!device) return res.status(404).json({ error: "Device not found" });

		// Remove device from user's devices array
		await User.findByIdAndUpdate(req.user._id, {
			$pull: { devices: device._id },
		});

		res.json({ message: "Device deleted successfully" });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Update device location/name
router.patch("/:rackId", auth, async (req, res) => {
	try {
		const { name, location } = req.body;
		const updateData = {};
		if (name) updateData.name = name;
		if (location) updateData.location = location;

		const device = await Device.findOneAndUpdate(
			{ rackId: req.params.rackId, owner: req.user._id },
			updateData,
			{ new: true }
		);

		if (!device) return res.status(404).json({ error: "Device not found" });
		res.json(device);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

module.exports = router;
