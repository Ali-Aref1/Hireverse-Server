const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const Server = {
    dbURI: process.env.DB_URI,
    serverPort: 3000
};

mongoose.connect(Server.dbURI, { dbName: 'hireverse' })
    .then(() => {
        console.log('Successfully connected to MongoDB Atlas and selected database hireverse');
    })
    .catch((err) => {
        console.error('Error connecting to MongoDB Atlas', err);
    });

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

async function createUser(req) {
    const { Fname, Lname, email, password } = req.body;
    const hashedPassword = await hashPassword(password);
    const user = new User({ Fname, Lname, email, password: hashedPassword });
    await user.save();
}

app.post('/register', async (req, res) => {
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
        res.status(409).send('Email is already in use.');
        return;
    }
    await createUser(req);
    res.send('User created');
});

app.get('/users', async (req, res) => {
    const users = await User.find();
    res.json(users);
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).exec();
    if (!user) {
        res.status(400).send('Invalid email');
        return;
    }
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    
    if (!isPasswordCorrect) {
        res.status(400).send('Invalid password');
        return;
    }
    res.send('Logged in successfully.');
});

// Start the server and store the reference
const server = app.listen(Server.serverPort, () => {
    console.log(`Server is running on port ${Server.serverPort}`);
});

// Handle cleanup on termination signals
process.on('SIGINT', () => {
    console.log('SIGINT received. Closing server...');
    server.close(() => {
        console.log('Express server closed');
        mongoose.connection.close(() => {
            console.log('Mongoose connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');
    server.close(() => {
        console.log('Express server closed');
        mongoose.connection.close();
        process.exit(0);
    });
});