const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid'); // npm install uuid

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

// Registration handler
async function register(req, res) {
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
        res.status(409).send('Email is already in use.');
        return;
    }
    const { Fname, Lname, email, password, rememberMe } = req.body; // <-- accept rememberMe
    const hashedPassword = await hashPassword(password);
    const user = new User({ Fname, Lname, email, password: hashedPassword });
    user.save().then(savedUser => {
        const jti = uuidv4();
        const accessToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign(
            { email: savedUser.email, id: savedUser._id, jti },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        console.log('[REGISTER] refreshToken jti:', jti);
        console.log('[REGISTER] refreshToken:', refreshToken);

        // Use same cookie logic as login
        const cookieOptions = {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
        };
        if (rememberMe) {
            cookieOptions.maxAge = 7 * 24 * 60 * 60 * 1000;
        }
        res.cookie('refreshToken', refreshToken, cookieOptions);

        // Handle rememberMe cookie
        if (rememberMe) {
            res.cookie('rememberMe', '1', { maxAge: 7 * 24 * 60 * 60 * 1000 });
        } else {
            res.clearCookie('rememberMe');
        }

        res.status(200).json({
            id: savedUser._id,
            accessToken,
            data: {
                Fname: savedUser.Fname,
                Lname: savedUser.Lname,
                email: savedUser.email
            }
        });
    }).catch(err => {
        res.status(500).send('Error saving user');
    });
}

// List users (FOR TESTING PURPOSES ONLY)
async function listUsers(req, res) {
    const users = await User.find();
    res.json(users);
}

// Login handler
async function login(req, res) {
    const { email, password, rememberMe } = req.body;
    const user = await User.findOne({ email }).exec();
    const id = user ? user._id : null;
    if (!user) {
        res.status(400).send('Invalid email or password');
        return;
    }
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
        res.status(400).send('Invalid email or password');
        return;
    }
    const jti = uuidv4();
    const accessToken = jwt.sign({ email, id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign(
        { email: user.email, id: user._id, jti },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

    // Set cookie options based on rememberMe
    const cookieOptions = {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
    };
    if (rememberMe) {
        cookieOptions.maxAge = 7 * 24 * 60 * 60 * 1000;
    }
    res.cookie('refreshToken', refreshToken, cookieOptions);

    res.json({
        id: user._id,
        accessToken,
        data: {
            Fname: user.Fname,
            Lname: user.Lname,
            email: user.email
        }
    });
}

async function logout(req, res) {
    const token = req.cookies.refreshToken;
    if (!token) {
        return res.status(401).send('No token provided');
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).send('Invalid token');
        // Optionally, you can add the token to a blacklist here
        res.clearCookie('refreshToken');
        res.status(200).send('Logged out successfully');
    });
}

// Refresh token handler
async function refreshToken(req, res, tokenBlacklist) {
    const token = req.cookies.refreshToken;
    if (!token) {
        return res.status(401).send('No token provided');
    }
    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) return res.status(401).send('Invalid token');
        if (tokenBlacklist.has(token)) return res.status(401).send('Outdated token. Please log in again.');
        tokenBlacklist.add(token);

        // Fetch user to get the id
        const user = await User.findOne({ email: decoded.email });
        if (!user) return res.status(401).send('User not found');

        // Issue new tokens with id
        const jti = uuidv4();
        const newAccessToken = jwt.sign(
            { email: decoded.email, id: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
        const newRefreshToken = jwt.sign(
            { email: decoded.email, id: user._id, jti },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        console.log('[REFRESH] refreshToken jti:', jti);
        console.log('[REFRESH] refreshToken:', newRefreshToken);

        // Always set as session cookie (no maxAge) for refreshes
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax'
        });

        res.json({ token: newAccessToken });
    });
}

async function getMe(req, res) {
    // req.user is set by authenticateToken middleware
    const user = await User.findOne({ email: req.user.email });
    if (!user) return res.status(404).send('User not found');
    res.json({
        id: user._id,
        Fname: user.Fname,
        Lname: user.Lname,
        email: user.email
    });
}

module.exports = {
    register,
    listUsers,
    login,
    logout,
    refreshToken,
    User, // Exported for use elsewhere if needed
    getMe,
};