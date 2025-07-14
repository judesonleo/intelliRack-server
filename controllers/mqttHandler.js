const Device = require("../models/Device");
const IngredientStatus = require("../models/IngredientStatus");
const IngredientLog = require("../models/IngredientLog");
const Alert = require("../models/Alert");

async function handleMQTTMessage(payload, io) {
	const { deviceId, slotId, tagUID, ingredient, weight, status } = payload;

	const device = await Device.findOne({ rackId: deviceId }).populate("owner");
	if (!device) {
		console.warn("Device not registered:", deviceId);
		return;
	}

	// Update live status
	await IngredientStatus.findOneAndUpdate(
		{ device: device._id, slotId },
		{ ingredient, tagUID, weight, status, lastUpdated: new Date() },
		{ upsert: true, new: true }
	);

	// Save log
	await IngredientLog.create({
		device: device._id,
		ingredient,
		tagUID,
		weight,
		status,
		slotId,
	});

	// WebSocket push
	io.emit("update", { deviceId, slotId, ingredient, weight, status });

	// Alerts
	if (["LOW", "VLOW", "EMPTY"].includes(status)) {
		await Alert.create({
			userId: device.owner._id,
			device: device._id,
			ingredient,
			slotId,
			type: status === "EMPTY" ? "EMPTY" : "LOW_STOCK",
		});
		io.emit("alert", { deviceId, slotId, ingredient, status });
	}
}

module.exports = handleMQTTMessage;
