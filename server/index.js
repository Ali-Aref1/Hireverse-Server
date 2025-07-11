const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const { io } = require("socket.io-client");
const { Server } = require("socket.io");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'uploads')))

// Configure CORS to allow all origins (wildcard)
app.use(cors({
    origin: 'http://localhost:5174',
    credentials: true,
}));

const ExpressServer = {
    dbURI: process.env.DB_URI,
    serverPort: 3000,
    dbName: process.env.DB_NAME
};
let tokenBlacklist = new Set();

// Connect to MongoDB Atlas
mongoose.connect(ExpressServer.dbURI, { dbName: ExpressServer.dbName })
    .then(() => {
        console.log(`Successfully connected to MongoDB Atlas and selected database ${ExpressServer.dbName}`);
    })
    .catch((err) => {
        console.error('Error connecting to MongoDB Atlas', err);
    });

// --- AUTH LOGIC MOVED TO auth.js ---
const auth = require('./auth');

const interviewData = require('./interview_store');

// Registration
app.post('/register', auth.register);

// List users (FOR TESTING PURPOSES ONLY)
app.get('/users', auth.listUsers);

// Login
app.post('/login', auth.login);

app.post('/logout', auth.logout);

// Refresh token
app.post('/refresh_token', (req, res) => auth.refreshToken(req, res, tokenBlacklist));


const authenticateToken = require('./middleware/authMiddleware');

// Protected routes
app.get('/me', authenticateToken, auth.getMe);

app.get('/get_interviews', authenticateToken,interviewData.getInterviewsByUserId);


// Start the server and store the reference
const server = app.listen(ExpressServer.serverPort, () => {
    console.log(`Server is running on port ${ExpressServer.serverPort}`);
});
const ReactSocket = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const FlaskSocket = io("http://localhost:5000");
FlaskSocket.on("connect", () => {
    console.log("Connected to Flask server");
});
FlaskSocket.on("disconnect", () => {
    console.log("Disconnected from Flask server");
});

// Move all socket logic to interviewersocket.js
const setupInterviewerSocket = require('./interviewersocket');
setupInterviewerSocket(ReactSocket, FlaskSocket);

// WebRTC socket logic
const setupWebRTCSocket = require('./webrtcsocket');
setupWebRTCSocket(ReactSocket);

// Handle cleanup on termination signals
process.on('SIGINT', async () => {
    console.log('SIGINT received. Closing server...');
    server.close(async () => {
        console.log('Express server closed');
        try {
            await mongoose.connection.close();
            console.log('Mongoose connection closed');
            process.exit(0);
        } catch (err) {
            console.error('Error closing Mongoose connection', err);
            process.exit(1);
        }
    });
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing server...');
    server.close(async () => {
        console.log('Express server closed');
        try {
            await mongoose.connection.close();
            process.exit(0);
        } catch (err) {
            console.error('Error closing Mongoose connection', err);
            process.exit(1);
        }
    });
});
