const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// User model
const User = mongoose.model('User', {
    Fname: String,
    Lname: String,
    email: String,
    password: String
},'users');

// Please run ALL passwords by this hashing function first
async function hashPassword(password) {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
}

// Create a new user
async function createUser(req) {
    const { Fname, Lname, email, password } = req.body;
    const hashedPassword = await hashPassword(password);
    const user = new User({ Fname, Lname, email, password: hashedPassword });
    await user.save();
}

// Registration handler
async function register(req, res) {
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
        res.status(409).send('Email is already in use.');
        return;
    }
    await createUser(req);
    res.send('User created');
}

// List users (FOR TESTING PURPOSES ONLY)
async function listUsers(req, res) {
    const users = await User.find();
    res.json(users);
}

// Login handler
async function login(req, res) {
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
    );
}

// Refresh token handler
async function refreshToken(req, res, tokenBlacklist) {
    const { token } = req.body;
    if (!token) {
        return res.status(401).send('No token provided');
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send('Invalid token');
        }
        if (tokenBlacklist.has(token)) {
            return res.status(401).send('Outdated token. Please log in again.');
        }
        tokenBlacklist.add(token);
        const newToken = jwt.sign({ email: decoded.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token: newToken });
    });
}

module.exports = {
    register,
    listUsers,
    login,
    refreshToken,
    User, // Exported for use elsewhere if needed
};