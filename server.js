"use strict";

//SETUP
const app = require("express")(),
    http = require("http").Server(app),
    mysql = require("mysql"),
    bcrypt = require("bcrypt"),
    io = require("socket.io")(http, {
        serveClient: false,
        pingInterval: 10000,
        pingTimeout: 5000,
        cookie: false
    }),
    connection = mysql.createConnection({
        host: "localhost",
        user: "sebo",
        password: "mypass",
        noBackslashEscapes: false,
        multipleStatements: true
    });
const saltRounds = 10;
const connectedRooms = new Array();
app.set("port", process.env.PORT || 3000);

//HTTP REQUESTS HANDLING
app.get("/", (req, res) => res.send("You have reached a Socket.io server"));
app.get("/*", (req, res) => res.redirect("/"));

//START SERVER
http.listen(app.get("port"), () => {
    console.log("Express server listening on port " + app.get("port"));
});

//CONNECT TO CLIENT
io.on("connection", (socket) => {
    let currentRoom = null;

    //SEND ROOM LIST TO CLIENT ON REQUEST
    socket.on("request-room-list", (ack) => {
        connection.query("SELECT * FROM chatdb.Room", (error, results, fields) => {
            if (error) {
                ack({
                    success: false,
                    error: "Couldn't get room list from database!"
                });
            } else {
                ack({
                    success: true,
                    roomList: results.map(result => {
                        return {
                            id: result.ID,
                            name: result.Name,
                            passwordProtected: result.Password ? "Yes" : "No",
                            numberOfClients: io.sockets.adapter.rooms[result.Name] ? io.sockets.adapter.rooms[result.Name].length : 0
                        };
                    })
                });
            }
        });
    });

    //ADD ROOM HANDLER
    socket.on("add-room", (newRoomInfo, ack) => {
        if (newRoomInfo.password) {
            bcrypt.hash(newRoomInfo.password, saltRounds, (err1, hash) => {
                if (err1) {
                    ack({ success: false, error: "Couldn't add room (password error)!" });
                } else {
                    bcrypt.hash(newRoomInfo.masterPassword, saltRounds, (err2, masterHash) => {
                        if (err2) {
                            ack({ success: false, error: "Couldn't add room (master password error)!" });
                        } else {
                            connection.query("INSERT INTO chatdb.Room(Name, Password, MasterPassword) VALUES (?, ?, ?)",
                                [newRoomInfo.name, hash, masterHash],
                                (error, results, fields) => {
                                    if (error) {
                                        ack({ success: false, error: "Couldn't add room to database!" });
                                    } else {
                                        ack({ success: true });
                                    }
                                });
                        }
                    });
                }
            });
        } else {
            bcrypt.hash(newRoomInfo.password, saltRounds, (err2, masterHash) => {
                if (err2) {
                    ack({ success: false, error: "Couldn't add room (master password error)!" });
                } else {
                    connection.query("INSERT INTO chatdb.Room(Name, MasterPassword) VALUES (?, ?)",
                        [newRoomInfo.name, masterHash],
                        (error, results, fields) => {
                            if (error) {
                                ack({ success: false, error: "Couldn't add room to database!\n" + error });
                            } else {
                                ack({ success: true });
                            }
                        });
                }
            });
        }
    });

    //ASSERT PASSWORD FOR SELECTED ROOM
    socket.on("room-select", (selectedRoom, ack) => {
        connection.query("SELECT * FROM chatdb.Room WHERE ID = ?", [selectedRoom.id], (error, results, fields) => {
            if (error) {
                ack({ success: false, error: "Couldn't retreive room list from database!" });
            } else {
                let targetRoom = results[0];
                if (targetRoom.Password) {
                    bcrypt.compare(selectedRoom.password, targetRoom.Password, (err, res) => {
                        if (res) {
                            //ADD CLIENT TO ROOM IF PASSWORD IS CORRECT
                            socket.join(selectedRoom.name, (err) => {
                                currentRoom = selectedRoom;
                                currentRoom.masterPassword = targetRoom.MasterPassword;
                                connectedRooms.push(currentRoom);
                                ack({ success: true });
                                io.in(currentRoom.name).emit("users-list", connectedRooms.map(room => room.username));
                            });
                        } else {
                            ack({ success: false, error: "Wrong password!" });
                        }
                    });
                } else {
                    socket.join(selectedRoom.name, (err) => {
                        currentRoom = selectedRoom;
                        currentRoom.masterPassword = targetRoom.MasterPassword;
                        connectedRooms.push(currentRoom);
                        ack({ success: true });
                        io.in(currentRoom.name).emit("users-list", connectedRooms.map(room => room.username));
                    });
                }
            }
        });
    });

    //REQUEST CHAT HISTORY
    socket.on("request-chat-history", (room, ack) => {
        connection.query("SELECT * FROM chatdb.Message WHERE Room_ID = ?", [room.id], (error, results, fields) => {
            if (error) {
                ack({ success: false, error: "Couldn't get messages from database!" });
            } else {
                ack({ success: true, results });
            }
        });
    });

    //EMIT CHAT MESSAGES TO OTHER MEMBERS OF THE ROOM
    socket.on("chat-message", (msg, ack) => {
        if (currentRoom) {
            connection.query("INSERT INTO chatdb.Message(User, Content, Room_ID) VALUES (?, ?, ?)",
                [currentRoom.username, msg.message, currentRoom.id],
                (error, results, fields) => {
                    if (error) {
                        ack({ success: false, error: "Couldn't send message! Try again!" });
                    } else {
                        ack({ success: true });
                        io.to(currentRoom.name).emit("chat-message", { Content: msg.message, User: currentRoom.username, Timestamp: new Date(Date.now()) });
                    }
                });
        }
    });

    //LEAVE ROOM
    socket.on("room-leave", (ack) => {
        socket.leave(currentRoom.name, (err) => {
            if (err) {
                ack({ success: false, error: err }, );
            } else {
                let index = connectedRooms.indexOf(currentRoom);
                if (index !== -1) connectedRooms.splice(index, 1);
                io.in(currentRoom.name).emit("users-list", connectedRooms.map(room => room.username));
                currentRoom = null;
                ack({ success: true });
            }
        });
    });

    //ON ROOM DELETE SIGNAL
    socket.on("room-delete", (masterPassword, ack) => {
        bcrypt.compare(masterPassword, currentRoom.masterPassword, (err, res) => {
            if (res) {
                connection.query("DELETE FROM chatdb.Message WHERE Room_ID=?; DELETE FROM chatdb.Room WHERE ID=?;",
                    [currentRoom.id, currentRoom.id],
                    (error, results, fields) => {
                        if (error) {
                            ack({ success: false, error: "Couldn't delete room from database!" });
                        } else {
                            ack({ success: true });
                            io.in(currentRoom.name).emit("room-deleted");
                        }
                    });
            } else {
                ack({ success: false, error: "Wrong master password!" });
            }
        });
    });

    socket.on("disconnect", () => {
        if (currentRoom) {
            let index = connectedRooms.indexOf(currentRoom);
            if (index !== -1) connectedRooms.splice(index, 1);
            io.in(currentRoom.name).emit("users-list", connectedRooms.map(room => room.username));
            currentRoom = null;
        }
    });
});