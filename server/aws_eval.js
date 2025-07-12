const aws = require('aws4');
const https = require('https');

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

async function sagemaker_evaluator(instances) {
    const region = 'eu-north-1';
    const service = 'sagemaker'; 
    const endpointName = 'hireverse-models';

    const body = JSON.stringify({
        instances: instances // expects [[...], ...]
    });

    const opts = aws.sign({
        host: `runtime.sagemaker.${region}.amazonaws.com`,
        method: 'POST',
        url: `https://runtime.sagemaker.${region}.amazonaws.com/endpoints/${endpointName}/invocations`,
        path: `/endpoints/${endpointName}/invocations`,
        service: service,
        region: region,
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    }, {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    console.log('Sending request to Sagemaker...')
    return new Promise((resolve, reject) => {
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    data = JSON.parse(data);
                    for (const key in data) {
                        if (Array.isArray(data[key]) && data[key].length === 1) {
                            data[key] = data[key][0];
                        }
                    }
                    resolve(data);
                    console.log('Sagemaker evaluation complete.')
                } catch (e) {
                    resolve(data); // fallback to raw if not JSON
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function extract_emotion(messages) {
    const data = JSON.stringify({
        messages: messages
    });
    
    const options = {
        hostname: 'localhost',
        port: 5000,
        path: '/extract_emotion',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
        },
    };
    
    console.log('Sending request to Flask emotion extractor...');
    
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
                        console.log('Emotion extraction complete.');
                        resolve(result.emotion_analysis);
                    } else {
                        reject(new Error(result.error || 'Failed to extract emotions'));
                    }
                } catch (e) {
                    reject(new Error('Invalid JSON response from emotion extractor'));
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

module.exports = {
    sagemaker_evaluator,
    extract_features,
    extract_emotion
};