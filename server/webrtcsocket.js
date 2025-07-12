const { RTCPeerConnection } = require("wrtc");
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const userBuffers = {}; // { userId: [Buffer, ...] }
const userStartTimes = {};
const userTimeouts = {};
const userPaused = {};
const userBufferSizes = {}; // Track buffer sizes for memory management
const MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB max buffer per user
const CHUNK_PROCESS_INTERVAL = 100; // Process chunks every 100ms

const uploadsDir = path.join(__dirname, 'uploads');

async function saveWebcamFile(userId,interview_id) {
  const savePath = path.join(__dirname, 'uploads');
  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);
  const timestamp = Date.now();
  const filePath = path.join(savePath, `${interview_id}.webm`);
  const tempPath = path.join(savePath, `${interview_id}_temp.webm`);
  const webmBuffer = Buffer.concat(userBuffers[userId] || []);

  try {
    fs.writeFileSync(tempPath, webmBuffer);
    if (webmBuffer.length === 0) {
      throw new Error("Webcam buffer is empty, not saving file.");
    }
    await new Promise((resolve, reject) => {
      ffmpeg(tempPath)
        .outputOptions('-c:v copy')
        .save(filePath)
        .on('end', resolve)
        .on('error', reject);
    });
    console.log(`[WebcamStream] Saved seekable video for user ${userId} at ${filePath}`);
    return `${interview_id}.webm`;
  } catch (err) {
    console.error(`[WebcamStream] Failed to process/save video for user ${userId}:`, err);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function endAndSaveVideo(userId,interviewDoc) {
  if (
    userBuffers[userId] &&
    userBuffers[userId].length > 0 &&
    Buffer.concat(userBuffers[userId]).length > 0
  ) {
    const filePath = await saveWebcamFile(userId, interviewDoc._id);
    delete userBuffers[userId];
    delete userStartTimes[userId];
    delete userPaused[userId];
    delete userBufferSizes[userId]; // Clean up buffer size tracking
    if (userTimeouts[userId]) {
      clearTimeout(userTimeouts[userId]);
      delete userTimeouts[userId];
    }
    return filePath;
  } else {
    console.log(`[WebcamStream] No data to save for user ${userId}`);
  }
}

async function endAndDeleteVideo(userId) {
  // Remove in-memory buffers and state
  if (userBuffers[userId]) delete userBuffers[userId];
  if (userStartTimes[userId]) delete userStartTimes[userId];
  if (userPaused[userId]) delete userPaused[userId];
  if (userBufferSizes[userId]) delete userBufferSizes[userId]; // Clean up buffer size tracking
  if (userTimeouts[userId]) {
    clearTimeout(userTimeouts[userId]);
    delete userTimeouts[userId];
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
  // Throttled chunk processing to prevent overwhelming the server
  const chunkQueues = {}; // { userId: [chunks...] }
  const processingUsers = new Set(); // Track which users are being processed

  const processChunkQueue = async (userId) => {
    if (processingUsers.has(userId)) return;
    if (!chunkQueues[userId] || chunkQueues[userId].length === 0) return;

    processingUsers.add(userId);
    
    try {
      const chunks = chunkQueues[userId].splice(0, 5); // Process max 5 chunks at a time
      for (const chunk of chunks) {
        if (userPaused[userId]) break; // Stop processing if paused
        
        const buffer = Buffer.from(chunk);
        if (!userBuffers[userId]) {
          userBuffers[userId] = [];
          userBufferSizes[userId] = 0;
        }
        
        // Check buffer size limit
        if (userBufferSizes[userId] + buffer.length > MAX_BUFFER_SIZE) {
          console.warn(`[WebRTC] Buffer size limit reached for user ${userId}, dropping oldest data`);
          // Remove oldest chunks to make room
          while (userBuffers[userId].length > 0 && userBufferSizes[userId] + buffer.length > MAX_BUFFER_SIZE) {
            const removed = userBuffers[userId].shift();
            userBufferSizes[userId] -= removed.length;
          }
        }
        
        userBuffers[userId].push(buffer);
        userBufferSizes[userId] += buffer.length;
      }
    } finally {
      processingUsers.delete(userId);
      
      // Schedule next processing if there are more chunks
      if (chunkQueues[userId] && chunkQueues[userId].length > 0) {
        setTimeout(() => processChunkQueue(userId), CHUNK_PROCESS_INTERVAL);
      }
    }
  };

  io.on("connection", (socket) => {
    let peer = null;
    let dataChannel = null;

    socket.on("webrtc_offer", async ({ userId, offer }) => {
      try {
        // Configure peer connection with bandwidth optimizations
        peer = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          iceCandidatePoolSize: 10
        });
        
        peer.ondatachannel = (event) => {
          dataChannel = event.channel;
          if (!userBuffers[userId]) {
            userBuffers[userId] = [];
            userStartTimes[userId] = Date.now();
            userBufferSizes[userId] = 0;
            chunkQueues[userId] = [];
          }

          dataChannel.onmessage = (event) => {
            if (userPaused[userId]) {
              return; // Skip processing if paused
            }
            
            if (typeof event.data === "string") {
              try {
                const msg = JSON.parse(event.data);
                console.log(`[WebRTC] Parsed DataChannel message:`, msg);
              } catch (err) {
                console.error(`[WebRTC] Failed to parse DataChannel string message:`, err);
              }
            } else {
              // Add to queue instead of immediate processing
              if (!chunkQueues[userId]) chunkQueues[userId] = [];
              chunkQueues[userId].push(event.data);
              
              // Start processing if not already running
              processChunkQueue(userId);
            }
          };

          dataChannel.onerror = (error) => {
            console.error(`[WebRTC] DataChannel error for user ${userId}:`, error);
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

        peer.onconnectionstatechange = () => {
          console.log(`[WebRTC] Connection state for user ${userId}: ${peer.connectionState}`);
          if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
            console.log(`[WebRTC] Connection failed/disconnected for user ${userId}`);
          }
        };

      } catch (error) {
        console.error(`[WebRTC] Error handling offer for user ${userId}:`, error);
      }
    });

    socket.on("webrtc_ice_candidate", async ({ candidate }) => {
      if (peer) {
        try {
          await peer.addIceCandidate(candidate);
        } catch (error) {
          console.error(`[WebRTC] Error adding ICE candidate:`, error);
        }
      }
    });

    socket.on("disconnect", () => {
      if (peer) peer.close();
    });

    socket.on("video_chunk", ({ userId, chunk }) => {
      if (!chunk) {
        console.error(`[WebcamStream] Received undefined chunk for user ${userId}`);
        return;
      }
      
      // Add to processing queue instead of immediate buffer
      if (!chunkQueues[userId]) chunkQueues[userId] = [];
      chunkQueues[userId].push(chunk);
      
      // Limit queue size to prevent memory issues
      if (chunkQueues[userId].length > 100) {
        console.warn(`[WebRTC] Chunk queue too large for user ${userId}, dropping oldest chunks`);
        chunkQueues[userId] = chunkQueues[userId].slice(-50); // Keep only last 50 chunks
      }
      
      // Start processing
      processChunkQueue(userId);
    });
  });
};

// Expose a save function for external use
module.exports.endAndSaveVideo = endAndSaveVideo;
module.exports.pauseBuffering = pauseBuffering;
module.exports.resumeBuffering = resumeBuffering;
module.exports.endAndDeleteVideo = endAndDeleteVideo;