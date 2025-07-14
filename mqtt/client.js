const mqtt = require("mqtt");
const handleMQTTMessage = require("../controllers/mqttHandler");

function setupMQTT(io) {
	const client = mqtt.connect(process.env.MQTT_URL);

	client.on("connect", () => {
		console.log("MQTT connected");
		client.subscribe("intellirack/#");
	});

	client.on("message", async (topic, message) => {
		try {
			const payload = JSON.parse(message.toString());
			await handleMQTTMessage(payload, io);
		} catch (err) {
			console.error("MQTT Error:", err.message);
		}
	});
}

module.exports = setupMQTT;
