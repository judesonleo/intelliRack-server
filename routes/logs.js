const express = require("express");
const router = express.Router();
const IngredientLog = require("../models/IngredientLog");
const auth = require("../middleware/auth");

// Get recent logs for the logged-in user's devices
router.get("/", auth, async (req, res) => {
	const logs = await IngredientLog.find({})
		.sort({ timestamp: -1 })
		.limit(100)
		.populate({ path: "device", match: { owner: req.user._id } });
	// Filter out logs for devices not owned by the user
	res.json(logs.filter((log) => log.device));
});

// Get logs for a specific ingredient (for the user's devices)
router.get("/ingredient/:name", auth, async (req, res) => {
	const logs = await IngredientLog.find({
		ingredient: req.params.name,
	}).populate({ path: "device", match: { owner: req.user._id } });
	res.json(logs.filter((log) => log.device));
});

module.exports = router;
