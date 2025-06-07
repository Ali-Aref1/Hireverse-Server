const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const userBuffers = {}; // { userId: [Buffer, ...] }
const userStartTimes = {};
const userTimeouts = {};
const userPaused = {};


async function saveWebcamFile(userId) {
  const savePath = path.join(__dirname, 'uploads');
  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);
  const filePath = path.join(savePath, `${userId}_${Date.now()}.webm`);
  const tempPath = path.join(savePath, `${userId}_${Date.now()}_temp.webm`);
  const webmBuffer = Buffer.concat(userBuffers[userId]);

  try {
    fs.writeFileSync(tempPath, webmBuffer);
    await new Promise((resolve, reject) => {
      ffmpeg(tempPath)
        .outputOptions('-c copy') // Copy the codec to avoid re-encoding
        .save(filePath)
        .on('end', resolve)
        .on('error', reject);
    });
    console.log(`[WebcamStream] Saved seekable video for user ${userId} at ${filePath}`);
  } catch (err) {
    console.error(`[WebcamStream] Failed to process/save video for user ${userId}:`, err);
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function endAndSaveVideo(userId) {
  if (userBuffers[userId]) {
    await saveWebcamFile(userId);
    delete userBuffers[userId];
    delete userStartTimes[userId];
    delete userPaused[userId];
    if (userTimeouts[userId]) {
      clearTimeout(userTimeouts[userId]);
      delete userTimeouts[userId];
    }
  }
}

function setupWebcamStream(io) {
  io.on('connection', (socket) => {
    socket.on('video_chunk', ({ userId, chunk }) => {
      const buffer = Buffer.from(chunk); // chunk is an ArrayBuffer
      if (userPaused[userId]) return; // Ignore chunks while paused
      if (!userBuffers[userId]) {
        userBuffers[userId] = [];
        userStartTimes[userId] = Date.now();
      }
      userBuffers[userId].push(buffer);
    });

    socket.on('end_video', async ({ userId }) => {
      console.log(`[WebcamStream] Ending video stream for user ${userId}`);
      if (userBuffers[userId]) {
        await saveWebcamFile(userId);
        delete userBuffers[userId];
        delete userStartTimes[userId];
        delete userPaused[userId];
        if (userTimeouts[userId]) {
          clearTimeout(userTimeouts[userId]);
          delete userTimeouts[userId];
        }
      }
    });

    // Pause video stream (stop accepting chunks)
    socket.on('pause_video', ({ userId }) => {
      userPaused[userId] = true;
      console.log(`[WebcamStream] Paused video stream for user ${userId}`);
    });

    // Resume video stream (start accepting chunks again)
    socket.on('resume_video', ({ userId }) => {
      userPaused[userId] = false;
      console.log(`[WebcamStream] Resumed video stream for user ${userId}`);
    });

    socket.on('disconnect', () => {
      // No-op: session logic will handle timeout/end
    });
  });

  io.endAndSaveVideo = endAndSaveVideo; // Attach for external use
}

module.exports = setupWebcamStream;