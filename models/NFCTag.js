const mongoose = require("mongoose");

const nfcTagSchema = new mongoose.Schema(
	{
		uid: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		ingredient: {
			type: String,
			required: true,
			trim: true,
		},
		deviceId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Device",
			required: true,
		},
		slotId: {
			type: String,
			required: true,
		},
		status: {
			type: String,
			enum: ["active", "inactive", "lost"],
			default: "active",
		},
		lastSeen: {
			type: Date,
			default: Date.now,
		},
		writeCount: {
			type: Number,
			default: 0,
		},
		readCount: {
			type: Number,
			default: 0,
		},
		metadata: {
			type: Map,
			of: String,
			default: {},
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
	},
	{
		timestamps: true,
	}
);

// Index for efficient queries
nfcTagSchema.index({ deviceId: 1, slotId: 1 });
nfcTagSchema.index({ ingredient: 1 });
nfcTagSchema.index({ status: 1 });

// Virtual for full tag info
nfcTagSchema.virtual("tagInfo").get(function () {
	return {
		uid: this.uid,
		ingredient: this.ingredient,
		deviceId: this.deviceId,
		slotId: this.slotId,
		status: this.status,
		lastSeen: this.lastSeen,
		writeCount: this.writeCount,
		readCount: this.readCount,
	};
});

// Method to update read count
nfcTagSchema.methods.incrementReadCount = function () {
	this.readCount += 1;
	this.lastSeen = new Date();
	return this.save();
};

// Method to update write count
nfcTagSchema.methods.incrementWriteCount = function () {
	this.writeCount += 1;
	this.lastSeen = new Date();
	return this.save();
};

// Static method to find by UID
nfcTagSchema.statics.findByUID = function (uid) {
	return this.findOne({ uid: uid.toUpperCase() });
};

// Static method to find by device and slot
nfcTagSchema.statics.findByDeviceAndSlot = function (deviceId, slotId) {
	return this.findOne({ deviceId, slotId });
};

module.exports = mongoose.model("NFCTag", nfcTagSchema);
