const mongoose = require("mongoose");

const logSchema = new mongoose.Schema({
	ingredient: String,
	weight: Number,
	status: String,
	tagUID: String,
	timestamp: {
		type: Date,
		default: Date.now,
	},
});

module.exports = mongoose.model("Log", logSchema);
