"use strict";

var app = require("express")();
var http = require("http").Server(app);
var io = require("socket.io")(http);

app.set('port', process.env.PORT || 3000);

io.on("connection", (socket) => {
    console.log("a user connected");

    io.emit("welcome-message", "WELCOME TO A SOCKET.IO SERVER");

    socket.on("disconnect", () => {
        console.log("user disconnected");
    });

    socket.on("chat-message", (msg) => {
        console.log("Message: " + msg);
    });

});

app.get("/*", (req, res) => res.send("You have reached a Socket.io server"));

http.listen(app.get('port'), () => {
  console.log("Express server listening on port " + app.get('port'));
});






//http.createServer(app).listen(app.get('port'), function(){
//  console.log("Express server listening on port " + app.get('port'));
//});