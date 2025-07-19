require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const setupMQTT = require("./mqtt/client");
const Device = require("./models/Device");
const User = require("./models/User");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const corsOptions = {
	origin: [
		"http://localhost:3000",
		"http://localhost:3001",
		"https://intellirack.judesonleo.me",
	],
	credentials: true,
	methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json());
app.set("io", io);
app.set("port", process.env.PORT || 3000);
app.set("mongoURI", process.env.MONGO_URI);

app.use("/api/auth", require("./routes/auth"));
app.use("/api/devices", require("./routes/devices"));
app.use("/api/logs", require("./routes/logs"));
app.use("/api/alerts", require("./routes/alerts"));

// WebSocket connection handling
io.on("connection", (socket) => {
	console.log("Client connected:", socket.id);

	// Handle socket authentication
	socket.on("authenticate", async (data) => {
		try {
			const { userId } = data;
			if (userId) {
				socket.userId = userId;
				socket.emit("authenticated", { success: true, userId });
				console.log(`Socket ${socket.id} authenticated for user ${userId}`);
			} else {
				socket.emit("authenticated", {
					success: false,
					error: "No user ID provided",
				});
			}
		} catch (error) {
			console.error("Authentication error:", error);
			socket.emit("authenticated", { success: false, error: error.message });
		}
	});

	// Handle device commands from frontend
	socket.on("sendCommand", async (data) => {
		try {
			const { deviceId, command, ...commandData } = data;

			console.log(
				`Sending command to device ${deviceId}:`,
				command,
				commandData
			);

			// Get MQTT client from app settings
			const mqttClient = app.get("mqttClient");
			if (!mqttClient) {
				throw new Error("MQTT client not available");
			}

			// Determine MQTT topic based on command type
			let topic;
			let message;

			if (command === "broadcast") {
				// Broadcast command to all devices
				topic = `intellirack/broadcast/command`;
				message = JSON.stringify({
					command: commandData.broadcastCommand,
					...commandData,
				});
			} else {
				// Device-specific command
				topic = `intellirack/${deviceId}/command`;
				message =
					command === "set_config" ||
					command === "set_thresholds" ||
					command === "set_device"
						? JSON.stringify({ command, deviceId, ...commandData })
						: command;
			}

			console.log(`Publishing to MQTT topic: ${topic}`);
			console.log(`MQTT message: ${message}`);

			mqttClient.publish(topic, message);

			// Acknowledge command sent
			socket.emit("commandSent", { deviceId, command, success: true });
		} catch (error) {
			console.error("Command error:", error);
			socket.emit("commandSent", {
				deviceId: data.deviceId,
				command: data.command,
				success: false,
				error: error.message,
			});
		}
	});

	// Handle device discovery requests
	socket.on("discoverDevices", async (data) => {
		try {
			console.log("Device discovery requested");

			// For now, we'll implement a simple discovery mechanism
			// In a real implementation, you might scan the network for IntelliRack devices
			// or use mDNS discovery

			// Emit discovery results (placeholder)
			socket.emit("discoveryResults", {
				devices: [],
				message: "Device discovery completed",
			});
		} catch (error) {
			console.error("Discovery error:", error);
			socket.emit("discoveryResults", {
				devices: [],
				error: error.message,
			});
		}
	});

	// Handle device registration requests
	socket.on("registerDevice", async (data) => {
		try {
			const { name, rackId, location, firmwareVersion, ipAddress, macAddress } =
				data;

			console.log("Device registration requested:", {
				name,
				rackId,
				location,
				ipAddress,
			});
			console.log("Socket user ID:", socket.userId);

			// Get user from socket (you might need to implement user authentication for sockets)
			// For now, we'll use a placeholder user ID
			const userId = socket.userId; // You'll need to set this during authentication

			if (!userId) {
				console.log("No user ID found in socket, using fallback");
				// For development, use a fallback user ID
				// In production, you should implement proper socket authentication
				const fallbackUser = await User.findOne();
				if (fallbackUser) {
					socket.userId = fallbackUser._id;
					console.log("Using fallback user:", fallbackUser._id);
				} else {
					socket.emit("deviceRegistered", {
						success: false,
						error: "User not authenticated and no fallback user found",
					});
					return;
				}
			}

			// Check if device already exists
			const existingDevice = await Device.findOne({ rackId });
			if (existingDevice) {
				console.log("Device already exists:", existingDevice._id);
				socket.emit("deviceRegistered", {
					success: false,
					error: "Device with this Rack ID already exists",
				});
				return;
			}

			// Create new device
			const device = new Device({
				name: name || `IntelliRack ${rackId}`,
				rackId,
				location: location || "Unknown",
				firmwareVersion: firmwareVersion || "v2.0",
				owner: socket.userId,
				ipAddress,
				isOnline: true,
				lastSeen: new Date(),
				weightThresholds: {
					min: 5.0,
					low: 100.0,
					moderate: 200.0,
					good: 500.0,
					max: 5000.0,
				},
				settings: {
					ledEnabled: true,
					soundEnabled: false,
					autoTare: false,
					mqttPublishInterval: 5000,
				},
				calibrationFactor: 204.99,
			});

			console.log("Saving device to database:", device);
			await device.save();
			console.log("Device saved successfully:", device._id);

			// Add device to user's devices array
			await User.findByIdAndUpdate(socket.userId, {
				$push: { devices: device._id },
			});
			console.log("Device added to user's devices array");

			console.log(
				`Device ${rackId} registered successfully for user ${socket.userId}`
			);

			socket.emit("deviceRegistered", {
				success: true,
				message: "Device registered successfully",
				device: device,
			});

			// Notify all connected clients about the new device
			io.emit("deviceAdded", {
				deviceId: rackId,
				device: device,
			});
		} catch (error) {
			console.error("Registration error:", error);
			socket.emit("deviceRegistered", {
				success: false,
				error: error.message,
			});
		}
	});

	socket.on("disconnect", () => {
		console.log("Client disconnected:", socket.id);
	});
});

// Health check endpoint
app.get("/health", (req, res) => {
	const mqttClient = app.get("mqttClient");
	res.json({
		status: "OK",
		timestamp: new Date().toISOString(),
		mqtt: mqttClient && mqttClient.connected ? "connected" : "disconnected",
	});
});

mongoose
	.connect(app.get("mongoURI"))
	.then(() => {
		console.log("✅ MongoDB connected");
		const mqttClient = setupMQTT(io);
		app.set("mqttClient", mqttClient); // Store MQTT client for command handling
		server.listen(process.env.PORT, () =>
			console.log(`🚀 Server running on http://localhost:${process.env.PORT}`)
		);
	})
	.catch((err) => console.error("MongoDB Error:", err, app.get("mongoURI")));
