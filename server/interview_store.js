const mongoose = require('mongoose');
const sagemaker_evaluator = require('./aws_eval').sagemaker_evaluator;

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

async function extract_features(user_id, video_path) {
    const data = JSON.stringify({
        participant_id: user_id,
        video_filename: video_path
    });
    const options = {
      hostname: 'localhost',
      port:5000,
      path: '/extract_features',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };
    console.log('Sending request to Flask feature extractor...');
    return new Promise((resolve, reject) => {
        const req = require('http').request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    if (result.status === 'success') {
                        console.log('Feature extraction complete.');
                        resolve(result.instances);
                    } else {
                        reject(new Error(result.message || 'Failed to extract features'));
                    }
                } catch (e) {
                    reject(new Error('Invalid JSON response from feature extractor'));
                }
            });
        });
        req.on('error', (e) => {
            reject(e);
        });
        req.write(data);
        req.end();
    });


}


async function saveInterview(interviewData) {
    try {
        const interview = new Interview(interviewData);
        await interview.save();
        console.log('Inital interview data saved successfully:', interview);
        // Call the AWS SageMaker evaluator
        const features = await extract_features(interview.user_id, interview.video_path);
        const evaluation = await sagemaker_evaluator(features);
        // Update the interview with the evaluation results
        const FPL_scores = evaluation
        await Interview.updateOne(
            { _id: interview._id },
            { $set: { eval: { ...interviewData.eval, FPL_scores } } }
        );
    } catch (error) {
        console.error('Error saving interview:', error);
    }
}

module.exports = {
    Interview,
    saveInterview
};
