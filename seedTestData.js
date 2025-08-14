// Usage: node seedTestData.js
// This script creates test data with various stock levels:
// - EMPTY: 0g (completely out of stock)
// - VLOW: 10-80g (very low stock, urgent restock needed)
// - LOW: 50-150g (low stock, restock recommended)
// - OK: 200-400g (moderate stock)
// - GOOD: 400g+ (well stocked)
const mongoose = require("mongoose");
const IngredientLog = require("./models/IngredientLog");
const Device = require("./models/Device");
const User = require("./models/User");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const TEST_USER_EMAIL = "test@gmail.com";
const TEST_USER_PASSWORD = "test";
const TEST_DEVICE_RACKID = "rack_001";
const INGREDIENTS = [
	"Flour",
	"Sugar",
	"Rice",
	"Coffee",
	"Salt",
	"Pepper",
	"Tea",
	"Cocoa",
];
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

			// Create some ingredients that are consistently low/empty for testing
			if (ingredient === "Salt" && slotId === "1") {
				// Salt in slot 1 will be consistently low
				weight = Math.floor(Math.random() * 80) + 20; // 20-100g
			} else if (ingredient === "Pepper" && slotId === "2") {
				// Pepper in slot 2 will be consistently very low
				weight = Math.floor(Math.random() * 50) + 10; // 10-60g
			} else if (ingredient === "Tea") {
				// Tea will sometimes be empty
				if (day % 12 === 0) {
					weight = 0;
				} else {
					weight = Math.floor(Math.random() * 150) + 50; // 50-200g
				}
			}

			// Simulate different stock scenarios
			let stockScenario = day % 15; // Different scenarios every 15 days

			if (stockScenario === 0) {
				// Empty stock scenario
				weight = 0;
			} else if (stockScenario === 5) {
				// Low stock scenario (between 50-150g)
				weight = Math.floor(Math.random() * 100) + 50;
			} else if (stockScenario === 10) {
				// Very low stock scenario (between 10-80g)
				weight = Math.floor(Math.random() * 70) + 10;
			} else {
				// Normal usage pattern
				let usage = Math.floor(Math.random() * 3) + 1; // 1-3g per day
				weight -= usage;

				// Ensure weight doesn't go below 0
				if (weight < 0) weight = 0;

				// Random restock chance (20% probability)
				if (Math.random() < 0.2) {
					weight = Math.floor(Math.random() * 400) + 600; // 600-1000g
				}
			}

			// Determine status based on weight
			let status;
			if (weight === 0) {
				status = "EMPTY";
			} else if (weight < 100) {
				status = "VLOW"; // Very low
			} else if (weight < 200) {
				status = "LOW";
			} else if (weight < 400) {
				status = "OK";
			} else {
				status = "GOOD";
			}
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
