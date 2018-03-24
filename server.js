"use strict";

var app = require("express")();
var http = require("http").Server(app);
var io = require("socket.io")(http);
app.set("port", process.env.PORT || 3000);


io.on("connection", (socket) => {
    console.log("a user connected");

    socket.on("disconnect", () => {
        console.log("user disconnected");
    });
});


app.get("/", (req, res) => res.send("You have reached a Socket.io server"));
app.get("/:msg", (req, res) => {
    io.emit("message", req.params.msg);
});
app.get("/*", (req, res) => res.redirect("/"));

http.listen(app.get("port"), () => {
  console.log("Express server listening on port " + app.get("port"));
});