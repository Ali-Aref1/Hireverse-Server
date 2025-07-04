const sessions = {}; // { [mongoUserId]: { socketId, messages: [], timeout: NodeJS.Timeout|null } }

let chalk;
(async () => {
    chalk = (await import('chalk')).default;
})();

const webrtcSocket = require('./webrtcsocket');


module.exports = function setupInterviewerSocket(ReactSocket, FlaskSocket) {

    const timeoutDuration = 60000; // Default timeout duration in milliseconds
    const webcamIO = ReactSocket; // Use the same socket.io instance

    // Handle AI responses from Flask
    FlaskSocket.on("ai_response", (data) => {
        // data: { phase, response, recipient }
        // Store the message in the correct session
        for (const userId in sessions) {
            if (sessions[userId].socketId === data.recipient) {
                sessions[userId].messages.push({
                    sender: "Interviewer",
                    message: data.response,
                    phase: data.phase
                });
                break;
            }
        }
        // Forward to the correct socket
        const targetSocket = ReactSocket.sockets.sockets.get(data.recipient);
        if (targetSocket) {
            targetSocket.emit("ai_response", data.response);
        } else {
            console.log(`Socket with ID ${data.recipient} not found`);
        }
    });

    FlaskSocket.on("flask_server_error", async (data) => {
        // data: { response, recipient }
        // Find the userId whose user_id matches data.recipient
        let targetSocketId = null;
        let userId = null;
        for (const id in sessions) {
            if (id === data.recipient) {
                targetSocketId = sessions[id].socketId;
                userId = id;
                break;
            }
        }
        if (targetSocketId) {
            const targetSocket = ReactSocket.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                targetSocket.emit("error", data.response);
                console.log(`Flask server error sent to user ${data.recipient}: ${JSON.stringify(data.response)}`);
            } else {
                console.log(`Socket with ID ${targetSocketId} not found for flask_server_error`);
            }
            // Cleanly end the user's session and cancel their video recording
            if (userId && sessions[userId]) {
                // End video recording (delete it)
                if (typeof webrtcSocket.endAndDeleteVideo === 'function') {
                    try {
                        await webrtcSocket.endAndDeleteVideo(userId);
                    } catch (err) {
                        console.log(`Error deleting video for user ${userId}:`, err);
                    }
                }
                delete sessions[userId];
                console.log(`Session for user ${userId} ended due to flask server error.`);
            }
        } else {
            console.log(`No session found for user_id ${data.recipient} on flask_server_error`);
        }
    });

    ReactSocket.on("connection", (socket) => {
        socket.on("attach_user", (data) => {
            const userId = data.id || data._id;
            socket.user = data;

            if (sessions[userId]) {
                if (sessions[userId].timeout) {
                    clearTimeout(sessions[userId].timeout);
                    sessions[userId].timeout = null;
                    // Resume video stream if reconnecting
                    webrtcSocket.resumeBuffering(userId);
                }
                sessions[userId].socketId = socket.id;
                socket.emit("message_history", sessions[userId].messages);
                console.log(`User ${userId} reconnected. Sent message history.`);
            } else {
                sessions[userId] = {
                    socketId: socket.id,
                    messages: [],
                    timeout: null
                };
                FlaskSocket.emit("start_interview", { userId, socketId: socket.id, name: `${data.data.Fname} ${data.data.Lname}` });
                console.log(`User ${userId} started a new interview.`);
                console.log(sessions)
            }
        });

        socket.on("message", (msg) => {
            const userId = socket.user?.id || socket.user?._id;
            if (!userId) return;
            const messageObj = {
                sender: "You",
                message: msg
            };
            if (sessions[userId]) {
                sessions[userId].messages.push(messageObj);
            }
            FlaskSocket.emit("message", {
                userId,
                socketId: socket.id,
                message: msg
            });
            console.log(`${chalk.red("[CHAT]")} ${chalk.yellow(`${socket.user.data.Fname} ${socket.user.data.Lname}`)}: ${msg}`);
        });

        // Handle explicit session end (e.g., user clicks back)
        socket.on("end_session", async () => {
            const userId = socket.user?.id || socket.user?._id;
            if (userId && sessions[userId]) {
                const targetSocket = webcamIO.sockets.sockets.get(sessions[userId].socketId);
                if (targetSocket && targetSocket.connected) {
                    targetSocket.emit('end_video', { userId });
                }
                // Also save on backend in case frontend doesn't respond
                if (typeof webrtcSocket.endAndSaveVideo === 'function') {
                    await webrtcSocket.endAndSaveVideo(userId);
                }
                delete sessions[userId];
                console.log(`Session for user ${userId} ended by user action.`);
            }
        });

        socket.on("disconnect", () => {
            const userId = socket.user?.id || socket.user?._id;
            if (!userId || !sessions[userId]) return;
            webcamIO.to(sessions[userId].socketId).emit('pause_video', { userId });
            webrtcSocket.pauseBuffering(userId);
            sessions[userId].timeout = setTimeout(async () => {
                // Save video on backend after timeout
                if (typeof webrtcSocket.endAndSaveVideo === 'function') {
                    await webrtcSocket.endAndSaveVideo(userId);
                }
                delete sessions[userId];
                console.log(`Session for user ${userId} expired after disconnect.`);
            }, timeoutDuration || 60000); // Default to 60 seconds
            console.log(`User ${userId} disconnected. Session will expire in 60 seconds unless they reconnect.`);
        });
    });
};