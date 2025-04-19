const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const Server = {
    dbURI: process.env.DB_URI,
    serverPort: 3000,
    dbName: process.env.DB_NAME
};

// Connect to MongoDB Atlas
mongoose.connect(Server.dbURI, { dbName: Server.dbName })
    .then(() => {
        console.log(`Successfully connected to MongoDB Atlas and selected database ${Server.dbName}`);
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
    if (!user) {
        res.status(400).send('Invalid email or password');
        return;
    }
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    
    if (!isPasswordCorrect) {
        res.status(400).send('Invalid email or password');
        return;
    }
    res.send('Logged in successfully.');
});


app.post('/send_prompt', async (req, res) => {
    console.log("received post request: ", req.body);

    if (!req.body.user_input) {
        res.status(400).send('Error: prompt is undefined');
        return;
    }

    console.log("extracted prompt: ", req.body.user_input);
    try {
        const response = await axios.post('http://localhost:5000/ask_question', req.body);
        res.status(200).send(response.data);
    } catch (error) {
        console.error('Error forwarding request:', error.message);
        res.status(500).send('Error forwarding request');
    }
});

app.get('/start_interview', async (req, res) => {
    try {
        console.log("starting interview")
        const response = await axios.get('http://localhost:5000/start_interview');
        res.status(200).send(response.data);
    } catch (error) {
        console.error('Error forwarding request:', error.message);
        res.status(500).send('Error forwarding request');
    }
});

// Start the server and store the reference
const server = app.listen(Server.serverPort, () => {
    console.log(`Server is running on port ${Server.serverPort}`);
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
