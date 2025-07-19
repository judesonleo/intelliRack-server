const mqtt = require("mqtt");
const {
	handleMQTTMessage,
	handleDeviceHeartbeat,
	startStatusMonitoring,
} = require("../controllers/mqttHandler");

function setupMQTT(io) {
	const client = mqtt.connect(
		process.env.MQTT_URL || "mqtt://broker.hivemq.com",
		{
			clientId: `intellirack-server-${Date.now()}`,
			clean: true,
			reconnectPeriod: 5000,
			connectTimeout: 30000,
		}
	);

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
				await handleDeviceHeartbeat(deviceId, payload, io);
			} else if (topic.includes("/status")) {
				// Device status update
				await handleDeviceHeartbeat(deviceId, payload, io);
			} else if (topic.includes("/weight") || topic.includes("/data")) {
				// Weight/ingredient data
				await handleMQTTMessage(payload, io);
			} else {
				// Default handling for other topics
				await handleMQTTMessage(payload, io);
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
