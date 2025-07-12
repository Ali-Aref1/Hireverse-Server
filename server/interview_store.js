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
        },
        emotion: { // Emotion analysis from candidate messages
                sadness: Number,
                happiness: Number,
                anger: Number,
                fear: Number,
                surprise: Number,
                neutral: Number
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
async function addEvaluation(interviewId, evaluationData) {
    try {
        const interview = await Interview.findById(interviewId);
        if (!interview) {
            throw new Error('Interview not found');
        }
        
        // Handle legacy calls with just FPL_scores
        if (evaluationData.FPL_scores) {
            interview.eval.FPL_scores = evaluationData.FPL_scores;
        } else {
            // Legacy format: evaluationData is directly FPL_scores
            interview.eval.FPL_scores = evaluationData;
        }
        
        // Add emotion data if provided
        if (evaluationData.emotion) {
            interview.eval.emotion = evaluationData.emotion;
        }
        
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
    console.log('Fetching interviews for user ID:', authenticatedUserId); // Debug log
    
    try {
        const interviews = await Interview.find({ user_id: authenticatedUserId });
        console.log('Found interviews:', interviews.length); // Debug log
        
        if (!interviews || interviews.length === 0) {
            return res.status(200).json([]); // Return empty array instead of 404
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
