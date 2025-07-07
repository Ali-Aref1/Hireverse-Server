const mongoose = require('mongoose');

const Interview = mongoose.model('Interview', {
    user_id: String,
    duration: Number,
    video_path: String,
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
        }
    }
},'interviews');

async function saveInterview(interviewData) {
    try {
        const interview = new Interview(interviewData);
        await interview.save();
        console.log('Interview saved successfully:', interview);
    } catch (error) {
        console.error('Error saving interview:', error);
    }
}

module.exports = {
    Interview,
    saveInterview
};
