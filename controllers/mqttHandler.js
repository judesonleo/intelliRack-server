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

		// Do not log or update status if ingredient is blank/null/whitespace
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
			ingredient, // <-- add this line
		});

		if (
			!ingredient ||
			typeof ingredient !== "string" ||
			ingredient.trim() === ""
		) {
			return;
		}

		// FILTER: Only log if significant change
		const lastLog = await IngredientLog.findOne({
			device: device._id,
			slotId,
		}).sort({ timestamp: -1 });

		let shouldLog = false;
		let logStatus = status;
		let eventType = null;
		let alertType = null;
		let alertDetails = null;
		const maxWeight = 20000; // 20kg

		if (!lastLog) {
			shouldLog = true;
		} else {
			const weightChanged =
				Math.abs((weight || 0) - (lastLog.weight || 0)) > 10;
			const statusChanged = status !== lastLog.status;
			const ingredientChanged = ingredient !== lastLog.ingredient;
			const slotChanged = slotId !== lastLog.slotId;
			shouldLog =
				weightChanged || statusChanged || ingredientChanged || slotChanged;
			// Impossible weight change
			if (Math.abs((weight || 0) - (lastLog.weight || 0)) > 10000) {
				logStatus = "SENSOR_ERROR";
				alertType = "SENSOR_ERROR";
				alertDetails = {
					reason: "Impossible weight change",
					weight,
					lastWeight: lastLog.weight,
				};
				shouldLog = true;
			}
			// Out of range
			if (weight < 0 || weight > maxWeight) {
				logStatus = "SENSOR_ERROR";
				alertType = "SENSOR_ERROR";
				alertDetails = { reason: "Out of range", weight };
				shouldLog = true;
			}
			// Restock detection
			if ((weight || 0) - (lastLog.weight || 0) > 100) {
				eventType = "RESTOCK";
				alertType = "RESTOCK";
				alertDetails = { weight, lastWeight: lastLog.weight };
				shouldLog = true;
			}
			// Batch usage detection
			if ((lastLog.weight || 0) - (weight || 0) > 1000) {
				eventType = "BATCH_USAGE";
				alertType = "BATCH_USAGE";
				alertDetails = { weight, lastWeight: lastLog.weight };
				shouldLog = true;
			}
		}

		// Filter out negative weights
		if (weight < 0) {
			shouldLog = false;
		}

		if (shouldLog) {
			// Update live status
			await IngredientStatus.findOneAndUpdate(
				{ device: device._id, slotId },
				{
					user: device.owner,
					ingredient,
					tagUID,
					weight,
					status: logStatus,
					lastUpdated: now,
					isOnline: true,
				},
				{ upsert: true, new: true }
			);

			// Save log
			const logDoc = await IngredientLog.create({
				user: device.owner,
				device: device._id,
				ingredient,
				tagUID,
				weight,
				status: logStatus,
				slotId,
				timestamp: now,
			});
			// Audit log for log creation
			const AuditLog = require("../models/AuditLog");
			await AuditLog.create({
				user: device.owner,
				action: "ingredient_log_created",
				details: { logId: logDoc._id, status: logStatus, eventType },
				timestamp: now,
			});

			// Create alert if needed
			if (alertType) {
				const Alert = require("../models/Alert");
				const existingAlert = await Alert.findOne({
					userId: device.owner._id,
					device: device._id,
					slotId,
					ingredient,
					type: alertType,
					acknowledged: false,
				});
				if (!existingAlert) {
					await Alert.create({
						userId: device.owner._id,
						device: device._id,
						ingredient,
						slotId,
						type: alertType,
						acknowledged: false,
						createdAt: now,
					});
					// Webhook
					const User = require("../models/User");
					const user = await User.findById(device.owner._id);
					if (user && user.webhookUrl) {
						try {
							await fetch(user.webhookUrl, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({
									alertType,
									ingredient,
									device: device._id,
									slotId,
									alertDetails,
									user: device.owner._id,
								}),
							});
						} catch {}
					}
					// Audit log for alert creation
					await AuditLog.create({
						user: device.owner._id,
						action: "alert_created",
						details: { alertType, ingredient, slotId, alertDetails },
						timestamp: now,
					});
				}
			}
		}

		// WebSocket push with enhanced data

		// Alerts
		if (["LOW", "VLOW", "EMPTY"].includes(status)) {
			const alertType = status === "EMPTY" ? "EMPTY" : "LOW_STOCK";
			const existingAlert = await Alert.findOne({
				userId: device.owner._id,
				device: device._id,
				slotId,
				ingredient,
				type: alertType,
				acknowledged: false,
			});
			if (!existingAlert || existingAlert.type !== alertType) {
				await Alert.create({
					userId: device.owner._id,
					device: device._id,
					ingredient,
					slotId,
					type: alertType,
				});
				console.log("Alert created:", alertType, ingredient, slotId);
				io.emit("alert", { deviceId, slotId, ingredient, status });
			} else {
				console.log(
					"Duplicate or unacknowledged alert skipped:",
					alertType,
					ingredient,
					slotId
				);
			}
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
	const Alert = require("../models/Alert");
	const User = require("../models/User");
	const AuditLog = require("../models/AuditLog");
	const OFFLINE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

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
						ingredient: device.ingredient,
					});

					// OFFLINE alert
					const existing = await Alert.findOne({
						userId: device.owner,
						device: device._id,
						type: "OFFLINE",
						acknowledged: false,
					});
					if (!existing) {
						await Alert.create({
							userId: device.owner,
							device: device._id,
							type: "OFFLINE",
							acknowledged: false,
							createdAt: new Date(),
						});
						const user = await User.findById(device.owner);
						if (user && user.webhookUrl) {
							try {
								await fetch(user.webhookUrl, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										alertType: "OFFLINE",
										device: device._id,
										user: device.owner,
									}),
								});
							} catch {}
						}
						await AuditLog.create({
							user: device.owner,
							action: "device_offline_alert_created",
							details: { device: device._id },
							timestamp: new Date(),
						});
					}
					console.log(`Device ${deviceId} marked as offline`);
				}
			} catch (error) {
				console.error("Status Check Error:", error);
			}
		} else {
			// If device was offline and is now back online, create ONLINE alert
			try {
				const device = await Device.findOne({ rackId: deviceId });
				if (device && !device.isOnline) {
					await Device.findByIdAndUpdate(device._id, {
						isOnline: true,
						mqttConnected: true,
						lastSeen: new Date(),
					});
					io.emit("deviceStatus", {
						deviceId,
						isOnline: true,
						lastSeen: new Date(),
					});
					const existing = await Alert.findOne({
						userId: device.owner,
						device: device._id,
						type: "ONLINE",
						acknowledged: false,
					});
					if (!existing) {
						await Alert.create({
							userId: device.owner,
							device: device._id,
							type: "ONLINE",
							acknowledged: false,
							createdAt: new Date(),
						});
						const user = await User.findById(device.owner);
						if (user && user.webhookUrl) {
							try {
								await fetch(user.webhookUrl, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										alertType: "ONLINE",
										device: device._id,
										user: device.owner,
									}),
								});
							} catch {}
						}
						await AuditLog.create({
							user: device.owner,
							action: "device_online_alert_created",
							details: { device: device._id },
							timestamp: new Date(),
						});
					}
					console.log(`Device ${deviceId} marked as online`);
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
