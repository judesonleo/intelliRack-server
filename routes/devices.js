const express = require("express");
const router = express.Router();
const Device = require("../models/Device");
const auth = require("../middleware/auth");
const User = require("../models/User");
// Register a new device
router.post("/register", auth, async (req, res) => {
	const { name, rackId, location } = req.body;
	try {
		const device = new Device({
			name,
			rackId,
			location,
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
	const devices = await Device.find({ owner: req.user._id });
	res.json(devices);
});

// Get a device by rackId
router.get("/:rackId", auth, async (req, res) => {
	const device = await Device.findOne({
		rackId: req.params.rackId,
		owner: req.user._id,
	});
	if (!device) return res.status(404).json({ error: "Device not found" });
	res.json(device);
});

module.exports = router;
