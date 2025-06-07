const { RTCPeerConnection } = require("wrtc");
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
  const webmBuffer = Buffer.concat(userBuffers[userId] || []);

  try {
    fs.writeFileSync(tempPath, webmBuffer);
    await new Promise((resolve, reject) => {
      ffmpeg(tempPath)
        .outputOptions('-c:v copy')
        .save(filePath)
        .on('end', resolve)
        .on('error', reject);
    });
    console.log(`[WebcamStream] Saved seekable video for user ${userId} at ${filePath}`);
  } catch (err) {
    console.error(`[WebcamStream] Failed to process/save video for user ${userId}:`, err);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function endAndSaveVideo(userId) {
  if (userBuffers[userId] && userBuffers[userId].length > 0) {
    await saveWebcamFile(userId);
    delete userBuffers[userId];
    delete userStartTimes[userId];
    delete userPaused[userId];
    if (userTimeouts[userId]) {
      clearTimeout(userTimeouts[userId]);
      delete userTimeouts[userId];
    }
  } else {
    console.log(`[WebcamStream] No data to save for user ${userId}`);
  }
}

function pauseBuffering(userId) {
  userPaused[userId] = true;
  console.log(`[WebRTC] Buffering paused for user ${userId}`);
}

function resumeBuffering(userId) {
  userPaused[userId] = false;
  console.log(`[WebRTC] Buffering resumed for user ${userId}`);
}

module.exports = function setupWebRTCSocket(io) {
  io.on("connection", (socket) => {
    let peer = null;
    let dataChannel = null;

    socket.on("webrtc_offer", async ({ userId, offer }) => {
      peer = new RTCPeerConnection();
      peer.ondatachannel = (event) => {
        dataChannel = event.channel;
        if (!userBuffers[userId]) {
          userBuffers[userId] = [];
          userStartTimes[userId] = Date.now();
        }

        dataChannel.onmessage = (event) => {
          if (userPaused[userId]) {
            // Optionally log or skip buffering
            return;
          }
          if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);
              console.log(`[WebRTC] Parsed DataChannel message:`, msg);
            } catch (err) {
              console.error(`[WebRTC] Failed to parse DataChannel string message:`, err);
            }
          } else {
            userBuffers[userId].push(Buffer.from(event.data));
          }
        };
      };

      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("webrtc_answer", { answer });

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("webrtc_ice_candidate", { candidate: event.candidate });
        }
      };
    });

    socket.on("webrtc_ice_candidate", async ({ candidate }) => {
      if (peer) {
        await peer.addIceCandidate(candidate);
      }
    });

    socket.on("disconnect", () => {
      if (peer) peer.close();
    });
  });
};

// Expose a save function for external use
module.exports.endAndSaveVideo = endAndSaveVideo;
module.exports.pauseBuffering = pauseBuffering;
module.exports.resumeBuffering = resumeBuffering;