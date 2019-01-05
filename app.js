// Enough to serve html files for chromecast
var http = require("http");
var fs = require("fs");
var serveStatic = require("serve-static");
var finalhandler = require("finalhandler");
var serve = serveStatic("public", {'index': 'index.html'});

http.createServer(function(req, res) {
    var done = finalhandler(req, res);
    serve(req, res, done);
}).listen(process.env.PORT || 1112);
