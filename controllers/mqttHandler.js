const Device = require("../models/Device");
const IngredientStatus = require("../models/IngredientStatus");
const IngredientLog = require("../models/IngredientLog");
const Alert = require("../models/Alert");
const NFCTag = require("../models/NFCTag");

// Device status tracking
const deviceStatus = new Map(); // Track last heartbeat for each device
const OFFLINE_THRESHOLD = 30000; // 30 seconds

async function handleMQTTMessage(payload, io) {
	const {
		deviceId,
		slotId,
		tagUID,
		ingredient,
		weight,
		status,
		timestamp,
		command,
		response,
	} = payload;

	try {
		// Find and update device
		const device = await Device.findOne({ rackId: deviceId }).populate("owner");
		if (!device) {
			console.warn("Device not registered:", deviceId);
			console.log(payload);
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
			timestamp: now,
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

		// Handle NFC events
		if (command && response) {
			await handleNFCEvent(device, command, response, io);
		}
	} catch (error) {
		console.error("MQTT Handler Error:", error);
	}
}

// Handle NFC events
async function handleNFCEvent(device, command, response, io) {
	try {
		switch (command) {
			case "nfc_read":
				// Parse NFC read response
				try {
					const nfcData = JSON.parse(response);
					if (nfcData.tagPresent && nfcData.tagUID) {
						// Find or create NFC tag
						let tag = await NFCTag.findByUID(nfcData.tagUID);

						if (tag) {
							// Update existing tag
							await tag.incrementReadCount();

							// Update ingredient status
							await IngredientStatus.findOneAndUpdate(
								{ device: device._id, slotId: tag.slotId },
								{
									ingredient: nfcData.ingredient || tag.ingredient,
									tagUID: nfcData.tagUID,
									lastUpdated: new Date(),
									isOnline: true,
								},
								{ upsert: true, new: true }
							);
						}

						// Emit NFC read event
						io.emit("nfcEvent", {
							type: "read",
							deviceId: device.rackId,
							tagUID: nfcData.tagUID,
							ingredient: nfcData.ingredient,
							timestamp: new Date(),
						});
					}
				} catch (parseError) {
					console.error("Error parsing NFC read response:", parseError);
				}
				break;

			case "nfc_write":

			case "write":
				// Handle NFC write response
				io.emit("nfcEvent", {
					type: "write",
					deviceId: device.rackId,
					response: response,
					timestamp: new Date(),
				});
				break;

			case "nfc_clear":
			case "clear":
				// Handle NFC clear response
				io.emit("nfcEvent", {
					type: "clear",
					deviceId: device.rackId,
					response: response,
					timestamp: new Date(),
				});
				break;

			case "nfc_format":
			case "format":
				// Handle NFC format response
				io.emit("nfcEvent", {
					type: "format",
					deviceId: device.rackId,
					response: response,
					timestamp: new Date(),
				});
				break;

			case "nfc_removed":
				// Handle NFC tag removal
				io.emit("nfcEvent", {
					type: "removed",
					deviceId: device.rackId,
					timestamp: new Date(),
				});
				break;

			default:
				// Handle other commands
				io.emit("commandResponse", {
					deviceId: device.rackId,
					command: command,
					response: response,
					timestamp: new Date(),
				});
		}
	} catch (error) {
		console.error("NFC Event Handler Error:", error);
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
	handleNFCEvent,
};
