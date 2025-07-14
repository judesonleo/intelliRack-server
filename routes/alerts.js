const express = require("express");
const router = express.Router();
const Alert = require("../models/Alert");
const auth = require("../middleware/auth");

// List all alerts for the logged-in user
router.get("/", auth, async (req, res) => {
	const alerts = await Alert.find({ userId: req.user._id }).sort({
		createdAt: -1,
	});
	res.json(alerts);
});

// Acknowledge an alert
router.post("/:id/acknowledge", auth, async (req, res) => {
	const alert = await Alert.findOneAndUpdate(
		{ _id: req.params.id, userId: req.user._id },
		{ acknowledged: true },
		{ new: true }
	);
	if (!alert) return res.status(404).json({ error: "Alert not found" });
	res.json(alert);
});

module.exports = router;
