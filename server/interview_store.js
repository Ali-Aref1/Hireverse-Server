const mongoose = require('mongoose');

const Interview = mongoose.model('Interview', {
    user_id: String,
    duration: Number,
    time: { type: Date, default: Date.now }, // Automatically set to current date
    messages:[
        {
            sender: String,
            message: String,
            phase: String
        }
    ],
    eval: {
        behavioural: {
            score: Number,
            feedback: String
        },
        technical: {
            score: Number,
            feedback: String
        },
        coding: {
            score: Number,
            feedback: String
        },
        FPL_scores: { // Facial, Prosodic & Lexical features
            EngagingTone: Number,
            RecommendHiring: Number,
            Friendly: Number,
            Colleague: Number,
            NoFillers: Number,
            Excited: Number,
            Calm: Number,
            NotAwkward: Number,
            NotStressed: Number
        }
    }
},'interviews');




async function saveInterview(interviewData) {
    try {
        const interview = new Interview(interviewData);
        await interview.save();
        return interview;
    } catch (error) {
        console.error('Error saving interview:', error);
        throw error;
    }
}
async function addEvaluation(interviewId, FPL_scores) {
    try {
        const interview = await Interview.findById(interviewId);
        if (!interview) {
            throw new Error('Interview not found');
        }
        interview.eval.FPL_scores = FPL_scores;
        await interview.save();
        return interview;
    } catch (error) {
        console.error('Error adding evaluation:', error);
        throw error;
    }
}

async function getInterviewById(interviewId) {
    try {
        const interview = await Interview.findById(interviewId);
        if (!interview) {
            throw new Error('Interview not found');
        }
        return interview;
    } catch (error) {
        console.error('Error retrieving interview:', error);
        throw error;
    }
}

async function getInterviewsByUserId(req, res) {
    // Use authenticated user's id
    const authenticatedUserId = req.user.id; // Set by JWT middleware
    try {
        const interviews = await Interview.find({ user_id: authenticatedUserId });
        if (!interviews || interviews.length === 0) {
            return res.status(404).json({ error: 'No interviews found for this user' });
        }
        res.json(interviews);
    } catch (error) {
        console.error('Error retrieving interviews:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


module.exports = {
    Interview,
    saveInterview,
    getInterviewById,
    getInterviewsByUserId,
    addEvaluation
};
