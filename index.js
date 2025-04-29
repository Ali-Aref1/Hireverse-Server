const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { io } = require("socket.io-client");
const { Server } = require("socket.io");
let chalk;
(async () => {
    chalk = (await import('chalk')).default;
  
    // Example usage
  })();

const app = express();
app.use(express.json());

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

//Please run ALL passwords by this hashing function first
async function hashPassword(password) {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
}

const User = mongoose.model('User', {
    Fname: String,
    Lname: String,
    email: String,
    password: String
});

//Create a new user
async function createUser(req) {
    const { Fname, Lname, email, password } = req.body;
    const hashedPassword = await hashPassword(password);
    const user = new User({ Fname, Lname, email, password: hashedPassword });
    await user.save();
}

//Handle Registration

app.post('/register', async (req, res) => {
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
        res.status(409).send('Email is already in use.');
        return;
    }
    await createUser(req);
    res.send('User created');
});


//List users (FOR TESTING PURPOSES ONLY)
app.get('/users', async (req, res) => {
    const users = await User.find();
    res.json(users);
});

//Handle Logins
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).exec();
    console.log(user);
    if (!user) {
        res.status(400).send('Invalid email or password');
        return;
    }
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    
    if (!isPasswordCorrect) {
        res.status(400).send('Invalid email or password');
        return;
    }
    res.json(
        {
            id: user._id,
            token: jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '30s' }),
            data: {
                Fname: user.Fname,
                Lname: user.Lname,
                email: user.email
            }
        }
    )
});

app.post('/refresh_token', async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(401).send('No token provided');
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send('Invalid token');
        }
        if( tokenBlacklist.has(token)) {
            return res.status(401).send('Outdated token. Please log in again.');
        }
        tokenBlacklist.add(token);
        const newToken = jwt.sign({ email: decoded.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token: newToken });
    });
}
);


// Start the server and store the reference
const server = app.listen(ExpressServer.serverPort, () => {
    console.log(`Server is running on port ${ExpressServer.serverPort}`);
});
// Initialize socket.io
const ReactSocket = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const FlaskSocket = io("http://localhost:5000");
FlaskSocket.on("connect", () => {
    console.log("Connected to Flask server");
}
);
FlaskSocket.on("disconnect", () => {
    console.log("Disconnected from Flask server");
}
);
FlaskSocket.on("ai_response", (data) => {
    console.log(`${chalk.red("[CHAT]")} ${chalk.cyan("Interviewer:")} ${data.response}`);
    // Emit the AI response to the React client
    const targetSocket = ReactSocket.sockets.sockets.get(data.recipient);
    if (targetSocket) {
        targetSocket.emit("ai_response", data.response);
    } else {
        console.log(`Socket with ID ${data.recipient} not found`);
    }
}
);



ReactSocket.on("connection", (socket) => {

    socket.on("disconnect", () => {
        console.log("A user disconnected:", socket.id);
    });
    socket.on("attach_user", (data) => {
        socket.user = data; // Mutate the socket object to store the user ID (From MongoDB)
        console.log(socket.user.data);
        FlaskSocket.emit("start_interview", { userId: socket.userId, socketId: socket.id, name:`${socket.user.data.Fname} ${socket.user.data.Lname}` }); // Emit the user ID to the Flask server
    });

    // Add your custom socket event handlers here
    socket.on("message", (data) => {
        console.log(`${chalk.red("[CHAT]")} ${chalk.yellow(`${socket.user.data.Fname} ${socket.user.data.Lname}`)}: ${data}`);
        const wrappedData = {
            userId: socket.userId, // Attach the user ID to the data
            socketId: socket.id, // Attach the socket ID to the data
            message: data
        }
        // Emit the message to the Flask server
        FlaskSocket.emit("message", wrappedData);
    });
});





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
