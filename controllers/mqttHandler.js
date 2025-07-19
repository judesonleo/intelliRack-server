const Device = require("../models/Device");
const IngredientStatus = require("../models/IngredientStatus");
const IngredientLog = require("../models/IngredientLog");
const Alert = require("../models/Alert");

// Device status tracking
const deviceStatus = new Map(); // Track last heartbeat for each device
const OFFLINE_THRESHOLD = 30000; // 30 seconds

async function handleMQTTMessage(payload, io) {
	const { deviceId, slotId, tagUID, ingredient, weight, status, timestamp } =
		payload;

	try {
		// Find and update device
		const device = await Device.findOne({ rackId: deviceId }).populate("owner");
		if (!device) {
			console.warn("Device not registered:", deviceId);
			return;
		}

		// Update device status
		const now = new Date();
		const deviceUpdate = {
			isOnline: true,
			lastSeen: now,
			lastWeight: weight || 0,
			lastStatus: status || "UNKNOWN",
			mqttConnected: true,
		};

		// Update IP address if provided
		if (payload.ipAddress) {
			deviceUpdate.ipAddress = payload.ipAddress;
		}

		// Update firmware version if provided
		if (payload.firmwareVersion) {
			deviceUpdate.firmwareVersion = payload.firmwareVersion;
		}

		await Device.findByIdAndUpdate(device._id, deviceUpdate);

		// Track heartbeat
		deviceStatus.set(deviceId, {
			lastHeartbeat: now.getTime(),
			deviceId,
			slotId,
			weight,
			status,
		});

		// Update live status
		await IngredientStatus.findOneAndUpdate(
			{ device: device._id, slotId },
			{
				ingredient,
				tagUID,
				weight,
				status,
				lastUpdated: now,
				isOnline: true,
			},
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
			timestamp: timestamp || now,
		});

		// WebSocket push with enhanced data
		io.emit("update", {
			deviceId,
			slotId,
			ingredient,
			weight,
			status,
			isOnline: true,
			lastSeen: now,
			ipAddress: payload.ipAddress,
		});

		// Device status update
		io.emit("deviceStatus", {
			deviceId,
			isOnline: true,
			lastSeen: now,
			weight,
			status,
		});

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
	} catch (error) {
		console.error("MQTT Handler Error:", error);
	}
}

// Handle device heartbeat/ping
async function handleDeviceHeartbeat(deviceId, payload, io) {
	try {
		const device = await Device.findOne({ rackId: deviceId });
		if (!device) return;

		const now = new Date();
		await Device.findByIdAndUpdate(device._id, {
			isOnline: true,
			lastSeen: now,
			mqttConnected: true,
		});

		deviceStatus.set(deviceId, {
			lastHeartbeat: now.getTime(),
			deviceId,
			...payload,
		});

		io.emit("deviceStatus", {
			deviceId,
			isOnline: true,
			lastSeen: now,
		});
	} catch (error) {
		console.error("Heartbeat Handler Error:", error);
	}
}

// Check for offline devices
async function checkDeviceStatus(io) {
	const now = Date.now();

	for (const [deviceId, status] of deviceStatus.entries()) {
		if (now - status.lastHeartbeat > OFFLINE_THRESHOLD) {
			try {
				const device = await Device.findOne({ rackId: deviceId });
				if (device && device.isOnline) {
					await Device.findByIdAndUpdate(device._id, {
						isOnline: false,
						mqttConnected: false,
					});

					io.emit("deviceStatus", {
						deviceId,
						isOnline: false,
						lastSeen: device.lastSeen,
					});

					console.log(`Device ${deviceId} marked as offline`);
				}
			} catch (error) {
				console.error("Status Check Error:", error);
			}
		}
	}
}

// Start periodic status checking
function startStatusMonitoring(io) {
	setInterval(() => checkDeviceStatus(io), 10000); // Check every 10 seconds
}

module.exports = {
	handleMQTTMessage,
	handleDeviceHeartbeat,
	startStatusMonitoring,
};
