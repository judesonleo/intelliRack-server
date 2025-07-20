const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");
// const Device = require("../models/Device");
const JWT_SECRET = process.env.JWT_SECRET || "secret-key";

router.post("/register", async (req, res) => {
	const { name, email, password } = req.body;
	const passwordHash = await bcrypt.hash(password, 10);
	const existingUser = await User.findOne({ email });
	if (existingUser) {
		return res.status(400).json({ message: "Email already in use" });
	}
	const user = new User({ name, email, passwordHash });
	await user.save();
	res.status(201).json({ message: "User registered" });
});

router.post("/login", async (req, res) => {
	const { email, password } = req.body;
	const user = await User.findOne({ email });
	if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
		return res.status(401).json({ error: "Invalid credentials" });
	}

	const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
	res.json({
		token,
		user: { _id: user._id, id: user._id, name: user.name, email: user.email },
	});
});

router.get("/me", authMiddleware, async (req, res) => {
	try {
		const user = await User.findById(req.user._id).populate("devices");
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Return user object with all necessary fields
		const userData = {
			_id: user._id,
			id: user._id,
			name: user.name,
			email: user.email,
			devices: user.devices,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		};

		res.json(userData);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// router.get("/me", authMiddleware, async (req, res) => {
// 	const user = req.user.toObject();
// 	const devices = await Device.find({ owner: req.user._id });
// 	user.devices = devices;
// 	res.json(user);
// });
module.exports = router;
