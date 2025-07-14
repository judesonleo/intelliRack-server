require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");
const setupMQTT = require("./mqtt/client");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.set("io", io);
app.set("port", process.env.PORT || 3000);
app.set("mongoURI", process.env.MONGO_URI);

app.use("/api/auth", require("./routes/auth"));
app.use("/api/devices", require("./routes/devices"));
app.use("/api/logs", require("./routes/logs"));
app.use("/api/alerts", require("./routes/alerts"));

mongoose
	.connect(app.get("mongoURI"))
	.then(() => {
		console.log("✅ MongoDB connected");
		setupMQTT(io);
		server.listen(process.env.PORT, () =>
			console.log(`🚀 Server running on http://localhost:${process.env.PORT}`)
		);
	})
	.catch((err) => console.error("MongoDB Error:", err, app.get("mongoURI")));
