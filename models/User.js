const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
	name: String,
	email: { type: String, unique: true },
	passwordHash: String,
	devices: [{ type: mongoose.Schema.Types.ObjectId, ref: "Device" }],
	webhookUrl: { type: String },
});

module.exports = mongoose.model("User", userSchema);
