const mqtt = require("mqtt");
const {
	handleMQTTMessage,
	handleDeviceHeartbeat,
	startStatusMonitoring,
} = require("../controllers/mqttHandler");

function setupMQTT(io) {
	// CA Certificate from environment variable or fallback
	const MQTT_CA = process.env.MQTT_CA;

	const mqttOptions = {
		clientId: `intellirack-server-${Date.now()}`,
		clean: true,
		reconnectPeriod: 5000,
		connectTimeout: 30000,
		keepalive: 60,
	};

	// Add MQTT credentials from environment variables
	if (process.env.MQTT_USERNAME) {
		mqttOptions.username = process.env.MQTT_USERNAME;
	}
	if (process.env.MQTT_PASSWORD) {
		mqttOptions.password = process.env.MQTT_PASSWORD;
	}

	// Use secure MQTT URL from environment or fallback
	const mqttUrl = process.env.MQTT_URL;

	// Detect if we're using secure or insecure MQTT
	// Check both protocol prefix and port number
	const isSecure = mqttUrl.startsWith("mqtts://");
	// Only apply SSL options for secure connections
	if (isSecure) {
		mqttOptions.protocol = "mqtts";
		mqttOptions.rejectUnauthorized = false;
		mqttOptions.ca = MQTT_CA;
		mqttOptions.secureProtocol = "TLSv1_2_method";
		mqttOptions.checkServerIdentity = (hostname, cert) => {
			return hostname === "mqtt.judesonleo.app"
				? undefined
				: new Error("Hostname mismatch");
		};
	} else {
		// For insecure connections, remove SSL options
		delete mqttOptions.protocol;
		delete mqttOptions.rejectUnauthorized;
		delete mqttOptions.ca;
		delete mqttOptions.secureProtocol;
		delete mqttOptions.checkServerIdentity;
	}

	console.log(`🔒 Connecting to MQTT broker: ${mqttUrl}`);
	console.log(
		`🔐 Protocol: ${isSecure ? "MQTTS (Secure)" : "MQTT (Insecure)"}`
	);
	if (isSecure) {
		console.log(`🔐 Using CA certificate for: mqtt.judesonleo.app`);
		console.log(
			`📜 Certificate source: ${
				process.env.MQTT_CA ? "Environment" : "Fallback"
			}`
		);
		// console.log(MQTT_CA);
	}

	const client = mqtt.connect(mqttUrl, mqttOptions);

	client.on("connect", () => {
		console.log("✅ MQTT connected to broker");
		client.subscribe("intellirack/#");
		client.subscribe("intellirack/+/heartbeat");
		client.subscribe("intellirack/+/status");

		// Start device status monitoring
		startStatusMonitoring(io);
	});

	client.on("message", async (topic, message) => {
		try {
			const payload = JSON.parse(message.toString());

			// Extract device ID from topic
			const topicParts = topic.split("/");
			const deviceId = topicParts[1];

			// Handle different message types
			if (topic.includes("/heartbeat")) {
				handleDeviceHeartbeat(deviceId, payload, io);
			} else if (topic.includes("/status")) {
				// Device status update
				handleDeviceHeartbeat(deviceId, payload, io);
			} else if (topic.includes("/response")) {
				// Command response from device
				console.log(`Command response from ${deviceId}:`, payload);

				// Emit command response event
				io.emit("commandResponse", {
					deviceId: payload.deviceId,
					command: payload.command,
					response: payload.response,
					timestamp: payload.timestamp,
					ingredient: payload.ingredient,
				});

				// Also emit specific NFC events for better frontend handling
				if (payload.command && payload.command.startsWith("nfc_")) {
					const nfcType = payload.command.replace("nfc_", "");
					io.emit("nfcEvent", {
						type: nfcType,
						deviceId: payload.deviceId,
						response: payload.response,
						timestamp: payload.timestamp,
					});
				}
			} else if (topic.includes("/weight") || topic.includes("/data")) {
				// Weight/ingredient data
				handleMQTTMessage(payload, io);
			} else {
				// Default handling for other topics
				handleMQTTMessage(payload, io);
			}
		} catch (err) {
			console.error("❌ MQTT Error:", err.message);
			console.error("Topic:", topic);
			console.error("Message:", message.toString());
		}
	});

	client.on("error", (error) => {
		console.error("❌ MQTT Connection Error:", error);
	});

	client.on("reconnect", () => {
		console.log("🔄 MQTT reconnecting...");
	});

	client.on("close", () => {
		console.log("🔌 MQTT connection closed");
	});

	return client;
}

module.exports = setupMQTT;
