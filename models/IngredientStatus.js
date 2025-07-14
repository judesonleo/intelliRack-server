const mongoose = require("mongoose");

const ingredientStatusSchema = new mongoose.Schema({
	ingredient: String,
	tagUID: String,
	device: { type: mongoose.Schema.Types.ObjectId, ref: "Device" },
	slotId: String,
	weight: Number,
	status: String,
	lastUpdated: { type: Date, default: Date.now },
});

module.exports = mongoose.model("IngredientStatus", ingredientStatusSchema);
