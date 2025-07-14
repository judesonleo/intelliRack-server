const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema({
	name: String,
	rackId: { type: String, required: true, unique: true },
	owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
	location: String,
	createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Device", deviceSchema);
