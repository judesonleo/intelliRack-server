const mongoose = require("mongoose");

const ingredientLogSchema = new mongoose.Schema({
	user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
	ingredient: String,
	tagUID: String,
	device: { type: mongoose.Schema.Types.ObjectId, ref: "Device" },
	slotId: String,
	weight: Number,
	status: String,
	source: { type: String, default: "device" },
	timestamp: { type: Date, default: Date.now },
});

ingredientLogSchema.index(
	{ device: 1, slotId: 1, timestamp: 1 },
	{ unique: true }
);

// Add index for batch prediction queries
ingredientLogSchema.index({ user: 1, ingredient: 1, timestamp: 1 });

// Add index for general ingredient queries
ingredientLogSchema.index({ user: 1, ingredient: 1 });

module.exports = mongoose.model("IngredientLog", ingredientLogSchema);
