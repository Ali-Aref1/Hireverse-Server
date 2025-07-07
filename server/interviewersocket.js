const sessions = {}; // { [mongoUserId]: { socketId, messages: [], timeout: NodeJS.Timeout|null, timer } }

let chalk;
(async () => {
    chalk = (await import('chalk')).default;
})();

const { saveInterview } = require('./interview_store');
const webrtcSocket = require('./webrtcsocket');
const Stopwatch = require('./timer'); // Import the Stopwatch class

const endSessionEarly = async (userId) => {
    if (typeof webrtcSocket.endAndDeleteVideo === 'function') {
            await webrtcSocket.endAndDeleteVideo(userId);
        }
        delete sessions[userId];
    }


module.exports = function setupInterviewerSocket(ReactSocket, FlaskSocket) {

    const timeoutDuration = 60000; // Default timeout duration in milliseconds
    const webcamIO = ReactSocket; // Use the same socket.io instance

    // Handle AI responses from Flask
    FlaskSocket.on("ai_response", (data) => {
        // data: { phase, response, recipient: user_id }
        // Find the session by user_id (data.recipient)
        const userId = data.recipient;
        const session = sessions[userId];
        if (session) {
            session.messages.push({
                sender: "Interviewer",
                message: data.response,
                phase: data.phase
            });
            console.log(`${chalk.red("[CHAT]")} ${chalk.cyan("Interviewer: ")} ${data.response}`);
            // Find the socket by session.socketId
            const targetSocket = ReactSocket.sockets.sockets.get(session.socketId);
            if (targetSocket) {
                targetSocket.emit("ai_response", data);
            } else {
                console.log(`Socket with ID ${session.socketId} not found for user ${userId}`);
            }
            if(data.phase === "end") {
                session.timer.pause()
                if (typeof webrtcSocket.endAndSaveVideo === 'function') {
                    webrtcSocket.endAndSaveVideo(userId).then((filePath) => {
                        console.log(`Video recording ended and saved for user ${userId}, filePath: ${filePath}`);
                        console.log(`Interview duration: ${session.timer.getTimeFormatted()}`);
                        const interviewData = {
                            user_id: userId,
                            duration: session.timer.getTime(),
                            video_path: filePath,
                            messages: session.messages,
                            eval: data.eval
                        };
                        saveInterview(interviewData).then(() => {
                            console.log(`Interview data saved for user ${userId}`);
                        }).catch(err => {
                            console.log(`Error saving interview data for user ${userId}:`, err);
                        });
                    }).catch(err => {
                        console.log(`Error saving video for user ${userId}:`, err);
                    });
                }
                // Cleanly end the user's session
                delete sessions[userId];
                console.log(`Session for user ${userId} ended after interview completion.`);
            }
        } else {
            console.log(`No session found for user_id ${userId} on ai_response`);
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
                    sessions[userId].timer.start(); // Resume the timer if it was paused
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
                    timeout: null,
                    timer: new Stopwatch()
                };
                // Start the timer for the session
                sessions[userId].timer.start();
                FlaskSocket.emit("start_interview", { userId, name: `${data.data.Fname} ${data.data.Lname}` });
                console.log(`User ${userId} started a new interview.`);
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
                message: msg
            });
            console.log(`${chalk.red("[CHAT]")} ${chalk.yellow(`${socket.user.data.Fname} ${socket.user.data.Lname}:`)} ${msg}`);
        });

        // Handle explicit session end (e.g., user clicks back)
        socket.on("end_session", async () => {
            const userId = socket.user?.id || socket.user?._id;
            if (!userId || !sessions[userId]) return;
            endSessionEarly(userId).catch(err => {
                console.log(`Error ending session for user ${userId}:`, err);
            }).finally(() => {
                console.log(`Session for user ${userId} ended explicitly.`);
                FlaskSocket.emit("end_interview", { userId });
            });
        });


        socket.on("disconnect", () => {
            const userId = socket.user?.id || socket.user?._id;
            if (!userId || !sessions[userId]) return;
            webcamIO.to(sessions[userId].socketId).emit('pause_video', { userId });
            webrtcSocket.pauseBuffering(userId);
            sessions[userId].timer.pause(); // Pause the timer on disconnect
            sessions[userId].timeout = setTimeout(async () => {
                // Delete video on backend after timeout
                endSessionEarly(userId).catch(err => {
                    console.log(`Error ending session for user ${userId}:`, err);
                }).finally(
                    () => {
                        console.log(`Session for user ${userId} ended due to inactivity.`);
                    }
                )
                
            }, timeoutDuration || 60000); // Default to 60 seconds
            console.log(`User ${userId} disconnected. Session will expire in 60 seconds unless they reconnect.`);
        });
    });
};