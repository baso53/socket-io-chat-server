"use strict";

//SETUP
const app = require("express")(),
    http = require("http").Server(app),
    mysql = require("mysql"),
    bcrypt = require("bcryptjs"),
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
const connectedRooms = new Array(); //ARRAY THAT KEEPS USERNAMES FOR EACH ROOM
app.set("port", process.env.PORT || 3000);

//HTTP REQUESTS HANDLING
app.get("/", (req, res) => res.send("You have reached a Socket.io server!"));
app.get("/*", (req, res) => res.redirect("/"));

//START SERVER
http.listen(app.get("port"), () => {
    console.log("Express server listening on port " + app.get("port"));
});

//CONNECT TO CLIENT
io.on("connection", (socket) => {
    //THIS WILL HAVE INFO ABOUT THE ROOM CLIENT IS IN
    let currentRoom = null;

    //SEND ROOM LIST TO CLIENT ON REQUEST
    socket.on("request-room-list", (ack) => {
        //GET ROOMS FROM DATABASE
        connection.query("SELECT * FROM localdb.Room", (error, results, fields) => {
            if (error) {
                ack({
                    success: false,
                    error: "Couldn't get room list from database!"
                });
            } else {
                //CREATE ARRAY OF ROOMS AND SEND IT TO CLIENT
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
        //CHECK IF ROOM NAME EXISTS
        if (!(io.sockets.adapter.rooms[newRoomInfo.name] === undefined)) {
            ack({ success: false, error: "Couldn't add room! (room already exists)" });
        } else {
            //CHECK IF USER SELECTED A PASSWORD FOR ENTERING THE ROOM
            if (newRoomInfo.password) {
                //HASH THE PASSWORD
                bcrypt.hash(newRoomInfo.password, saltRounds, (err1, hash) => {
                    if (err1) {
                        ack({ success: false, error: "Couldn't add room (password error)!" });
                    } else {
                        //HASH THE MASTER PASSWORD
                        bcrypt.hash(newRoomInfo.masterPassword, saltRounds, (err2, masterHash) => {
                            if (err2) {
                                ack({ success: false, error: "Couldn't add room (master password error)!" });
                            } else {
                                //INSERT ROOM INFO INTO DATABASE
                                connection.query("INSERT INTO localdb.Room(Name, Password, MasterPassword) VALUES (?, ?, ?)",
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
                //HASH THE MASTER PASSWORD
                bcrypt.hash(newRoomInfo.masterPassword, saltRounds, (err2, masterHash) => {
                    if (err2) {
                        ack({ success: false, error: "Couldn't add room (master password error)!" });
                    } else {
                        //INSERT ROOM INFO INTO DATABASE
                        connection.query("INSERT INTO localdb.Room(Name, Password, MasterPassword) VALUES (?, ?, ?)",
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
        }
    });

    //ASSERT IF SELECTED ROOM INFO MATCHES ROOM INFO IN DATABASE
    socket.on("room-select", (selectedRoom, ack) => {
        //CHECK IF CHOSEN USERNAME ALREADY EXISTS
        if (connectedRooms.filter(room => room.id === selectedRoom.id
            && room.username.toLowerCase() === selectedRoom.username.toLowerCase()).length > 0) {
            ack({ success: false, error: "This username is already in this room! Try another one!" });
        } else {
            //GET SELECTED ROOM BY ID FROM DATABASE
            connection.query("SELECT * FROM localdb.Room WHERE ID = ?", [selectedRoom.id], (error, results, fields) => {
                if (error) {
                    ack({ success: false, error: "Couldn't retreive room list from database!" });
                } else {
                    let targetRoom = results[0];
                    //CHECK IF ROOM HAS PASSWORD
                    if (targetRoom.Password) {
                        //COMPARE USER ENTERED PASSWORD WITH REAL PASSWORD
                        bcrypt.compare(selectedRoom.password, targetRoom.Password, (err, res) => {
                            selectedRoom.password = null; //DISGARD PLAIN TEXT PASSWORD ON SERVER
                            if (res) {
                                //ADD CLIENT TO ROOM IF PASSWORD IS CORRECT
                                socket.join(selectedRoom.name, (err) => {
                                    currentRoom = selectedRoom;
                                    currentRoom.masterPassword = targetRoom.MasterPassword; //KEEP MASTER PASSWORD HASH ON SERVER
                                    connectedRooms.push(currentRoom);

                                    
                                    //SEND EVENT TO CLIENTS IN THIS ROOM ABOUT NEW USER
                                    socket.to(currentRoom.name).emit("users-list", connectedRooms
                                    .filter(room => room.id === currentRoom.id)
                                    .map(room => room.username)); 

                                    
                                    ack({ success: true, connectedUsers: connectedRooms
                                        .filter(room => room.id === currentRoom.id)
                                        .map(room => room.username)  });
                                });
                            } else {
                                ack({ success: false, error: "Wrong password!" });
                            }
                        });
                    } else {
                        socket.join(selectedRoom.name, (err) => {
                            currentRoom = selectedRoom;
                            currentRoom.masterPassword = targetRoom.MasterPassword; //KEEP MASTER PASSWORD HASH ON SERVER
                            connectedRooms.push(currentRoom);

                            
                            //SEND EVENT TO CLIENTS IN THIS ROOM ABOUT NEW USER
                            socket.to(currentRoom.name).emit("users-list", connectedRooms
                            .filter(room => room.id === currentRoom.id)
                            .map(room => room.username));
                            
                            ack({ success: true, connectedUsers: connectedRooms
                                .filter(room => room.id === currentRoom.id)
                                .map(room => room.username) });
                        });
                    }
                }
            });
        }
    });

    //REQUEST CHAT HISTORY
    socket.on("request-chat-history", (room, ack) => {
        //GET MESSAGES FOR CURRENT ROOM FROM DATABASE
        connection.query("SELECT * FROM localdb.Message WHERE Room_ID = ?", [room.id], (error, results, fields) => {
            if (error) {
                ack({ success: false, error: "Couldn't get messages from database!" });
            } else {
                ack({ success: true, results });
            }
        });
    });

    //EMIT CHAT MESSAGES TO OTHER MEMBERS OF THE ROOM
    socket.on("chat-message", (msg, ack) => {
        //CHECK IF USER IS IN ROOM
        if (currentRoom) {
            //INSERT MESSAGE INTO DATABASE
            connection.query("INSERT INTO localdb.Message(User, Content, Room_ID) VALUES (?, ?, ?)",
                [currentRoom.username, msg.message, currentRoom.id],
                (error, results, fields) => {
                    if (error) {
                        ack({ success: false, error: "Couldn't send message! Try again!" });
                    } else {
                        ack({ success: true });
                        io.in(currentRoom.name).emit("chat-message", { Content: msg.message, User: currentRoom.username, Timestamp: new Date(Date.now()) });
                    }
                });
        }
    });

    //ON ROOM LEAVE SIGNAL
    socket.on("room-leave", (ack) => {
        //LEAVE ROOM FOR THIS CLIENT
        socket.leave(currentRoom.name, (err) => {
            if (err) {
                ack({ success: false, error: err }, );
            } else {
                let index = connectedRooms.indexOf(currentRoom);
                if (index !== -1) connectedRooms.splice(index, 1);
                
                //SEND EVENT TO CLIENTS IN ROOM ABOUT USER THAT LEFT
                socket.to(currentRoom.name).emit("users-list", connectedRooms
                .filter(room => room.id === currentRoom.id)
                .map(room => room.username));
                
                currentRoom = null;
                ack({ success: true });
            }
        });
    });

    //ON ROOM DELETE SIGNAL
    socket.on("room-delete", (masterPassword, ack) => {
        //COMPARE USER ENTERED MASTER PASSWORD WITH THE REAL ONE
        bcrypt.compare(masterPassword, currentRoom.masterPassword, (err, res) => {
            if (res) {
                //DELETE ROOM AND ALL OF ITS MESSAGES
                connection.query("DELETE FROM localdb.Message WHERE Room_ID=?; DELETE FROM localdb.Room WHERE ID=?;",
                    [currentRoom.id, currentRoom.id],
                    (error, results, fields) => {
                        if (error) {
                            ack({ success: false, error: "Couldn't delete room from database!" });
                        } else {
                            ack({ success: true });

                            //SEND EVENT THAT ROOM WAS DELETED
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

            //SEND EVENT TO CLIENTS IN ROOM ABOUT USER THAT LEFT IF USER WAS IN A ROOM
            socket.to(currentRoom.name).emit("users-list", connectedRooms
            .filter(room => room.id === currentRoom.id)
            .map(room => room.username));
            currentRoom = null;
        }
    });
});