const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
	device: { type: mongoose.Schema.Types.ObjectId, ref: "Device" },
	slotId: String,
	ingredient: String,
	type: {
		type: String,
		enum: ["LOW_STOCK", "EMPTY", "OVERWEIGHT"],
		required: true,
	},
	acknowledged: { type: Boolean, default: false },
	createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Alert", alertSchema);
