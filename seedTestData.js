// Usage: node seedTestData.js
const mongoose = require("mongoose");
const IngredientLog = require("./models/IngredientLog");
const Device = require("./models/Device");
const User = require("./models/User");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const TEST_USER_EMAIL = "test@gmail.com";
const TEST_USER_PASSWORD = "test";
const TEST_DEVICE_RACKID = "rack_001";
const INGREDIENTS = ["Flour", "Sugar", "Rice", "Coffee"];
const SLOTS = ["1", "2"];
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/test";

async function seed() {
	await mongoose.connect(MONGO_URI);

	// Find or create test user
	let user = await User.findOne({ email: TEST_USER_EMAIL });
	if (!user) {
		const passwordHash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
		user = await User.create({
			name: "Test User",
			email: TEST_USER_EMAIL,
			passwordHash,
		});
		console.log("Created test user:", user.email);
	} else {
		console.log("Using existing user:", user.email);
	}

	// Find or create test device
	let device = await Device.findOne({ rackId: TEST_DEVICE_RACKID });
	if (!device) {
		device = await Device.create({
			name: "Test Device",
			rackId: TEST_DEVICE_RACKID,
			owner: user._id,
			location: "Test Lab",
			firmwareVersion: "v2.0",
		});
		console.log("Created test device:", device.rackId);
	} else {
		console.log("Using existing device:", device.rackId);
	}

	const now = new Date();
	for (const slotId of SLOTS) {
		let ingredientIdx = 0;
		let weight = 1000;
		for (let day = 30; day >= 0; day--) {
			const date = new Date(now);
			date.setDate(now.getDate() - day);

			// Simulate substitution every 9 days
			if (day % 9 === 0 && day !== 0) {
				ingredientIdx = (ingredientIdx + 1) % INGREDIENTS.length;
				weight = 1000; // new ingredient, restock
			}
			const ingredient = INGREDIENTS[ingredientIdx];

			// Simulate anomaly every 11 days
			let anomaly = false;
			if (day % 11 === 0 && day !== 0) {
				weight -= 600; // big drop
				anomaly = true;
			}

			// Simulate normal usage
			let usage = Math.floor(Math.random() * 30 + 10);
			if (!anomaly) weight -= usage;
			if (weight < 0) weight = 0;

			// Simulate restock every 7 days
			if (day % 7 === 0 && day !== 0) weight = 1000;

			const status = weight === 0 ? "EMPTY" : weight < 200 ? "LOW" : "GOOD";
			try {
				await IngredientLog.create({
					user: user._id,
					device: device._id,
					ingredient,
					tagUID: "TESTUID" + slotId,
					slotId,
					weight,
					status,
					timestamp: new Date(date),
				});
			} catch (err) {
				if (err.code === 11000) {
					// Duplicate log, skip
				} else {
					console.error("Error creating log:", err);
				}
			}
		}
		console.log(`Seeded logs for slot ${slotId}`);
	}

	console.log("Test data seeded!");
	process.exit();
}

seed();
