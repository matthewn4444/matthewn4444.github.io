var BUFFER_END_TIMEOUT = 50;

function showBufferAnimation() {
    $("#progress").text("0%");
    $("#buffer").fadeIn();
    window.lastBufferPercent = 0;
    window.isBuffering = true;
}

function hideBufferAnimation() {
    window.isBuffering = false;
    if ($("#buffer").is(":visible")) {
        $("#buffer").fadeOut(200, function() {
            $(document.body).removeClass("preload");
        });
    }
    if (window.bufferTimer) {
        clearInterval(window.bufferTimer);
        window.bufferTimer = null;
    }
    if (window.seekPokeTimer) {
        clearInterval(window.seekPokeTimer);
        window.seekPokeTimer = null;
    }
}

function newPlayer() {
    // Remove the old player and add a new one
    if (window.subtitlePlayer) {
        window.subtitlePlayer.remove();
    }
    window.subtitlePlayer = new SSAPlayer({ video: window.mediaElement });
}

window.onload = function() {
//cast.receiver.logger.setLevelValue(cast.receiver.LoggerLevel.DEBUG);

    // Start the system
    console.log('Application is ready, starting system');
    window.mediaElement = document.getElementById('vid');
    window.mediaManager = new cast.receiver.MediaManager(window.mediaElement);
    window.castReceiverManager = cast.receiver.CastReceiverManager.getInstance();

    $(window.mediaElement).on("loadstart", function() {
        window.isPreloading = false;
        hideBufferAnimation();
        if (!$("#video-area").is(":visible")) {
            $("#video-area").fadeIn();
        }
        window.mediaElement.play();
    });

    $(window.mediaElement).on("abort ended error", function(e) {
        console.log(e);
        $("#video-area").fadeOut(200);
    });

    $(window.mediaElement).on("error", function(e) {
        $("#video-area").fadeOut(200);
        if (e.target.error) {
            switch (e.target.error.code) {
                case e.target.error.MEDIA_ERR_DECODE:
                case e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                case e.target.error.MEDIA_ERR_ABORTED:
                case e.target.error.MEDIA_ERR_NETWORK:
                    break;
                default:
                    window.close();
                    break;
            }
        }
    });

    // Handle Subtitles
    window.messageBus = window.castReceiverManager.getCastMessageBus('urn:x-cast:com.melonpan.messages');
    window.messageBus.onMessage = function(event) {
        try {
            var data = JSON.parse(event.data);
            if (data.action == "new.subtitle.player") {
                newPlayer();
            } else if (data.action == "set.subtitles.header") {
                // This is new ssa subtitle track
                if (!window.subtitlePlayer) newPlayer();
                window.subtitlePlayer.newTrack("track_" + data.number, data.header);
            } else if (data.action == "add.subtitles") {
                // Add subtitles streamed from sender app
                if (!window.subtitlePlayer) newPlayer();
                for (var i = 0; i < data.tracks.length; i++) {
                    window.subtitlePlayer.addSubtitleEvent("track_" + data.number, data.tracks[i]);
                }
            } else if (data.action == "select.subtitles.track") {
                if (!window.subtitlePlayer) newPlayer();
                if (data.hasOwnProperty("number")) {
                    window.subtitlePlayer.selectTrack("track_" + data.number);
                } else {
                    // Hide subtitles
                    window.subtitlePlayer.selectTrack("");
                }
            } else if (data.action == "preload.font") {
                // Preload each font; add the font into each element to start preloading
                for (var i = 0; i < data.fonts.length; i++) {
                    var fontData = data.fonts[i];
                    $("head").append($("<style>").text("@font-face{font-family:'" + fontData.name + "';src:url('" + fontData.url + "') format('truetype');}"));
                    var el = document.createElement("span");
                    el.style.fontFamily = fontData.name;
                    document.getElementById("font-preloader").appendChild(el);
                }
            } else if (data.action == "player.error") {
                // Ends the video and shows errors to the user
                $("#error").text(data.message).animate({top: "40px"}, 400);
                $("#video-area").fadeOut(200);
                setTimeout(function(){
                    $("#error").animate({top: "-100px"}, 400);
                }, 8000);
            } else if (data.action == "player.hide") {
                $("#video-area").fadeOut(200);
            }

            // Streaming related events
            else if (data.action == "preload.stream") {
                // Preload the video backdrop for torrent
                $("body").addClass("preload");
                $("#video-area").fadeIn(500, showBufferAnimation);
                window.isPreloading = true;
            } else if (data.action == "buffer.start" && !$("#buffer").is(":visible")) {
                console.log("buffer");
                showBufferAnimation();

                // Run an interval to see when the video has finished buffering and starts to play
                window.lastPlayTime = window.mediaElement.currentTime;
                if (window.bufferTimer) {
                    clearInterval(window.bufferTimer);
                }
                window.bufferChangeCount = 0;
                window.bufferTimer = setInterval(function() {
                    if (window.mediaElement.currentTime > (1 / BUFFER_END_TIMEOUT + window.lastPlayTime) && !window.mediaElement.paused) {
                        window.bufferChangeCount++;
                        // If user seeks multiple times, then animation would be removed, we avoid with the count
                        if (window.bufferChangeCount > 2) {
                            hideBufferAnimation();
                        }
                    } else {
                        window.bufferChangeCount = 0;
                    }
                    window.lastPlayTime = window.mediaElement.currentTime;
                }, BUFFER_END_TIMEOUT);
            } else if (data.action == "buffer.precentage") {
                // Never show 100% because it could be waiting a little longer
                // Also never show a lower number than what is already being shown
                var percent = parseInt(data.percentage, 10);

                // Apply a hack that would ask the app for more data if chromecast stalls on seek
                if (percent >= 100 && window.isBuffering && window.isPreloading) {
                    if (window.seekPokeTimer) {
                        clearInterval(window.seekPokeTimer);
                    }
                    window.seekPokeTimer = setInterval(function() {
                        try {
                            window.mediaElement.play().then(window.mediaElement.pause);
                        } catch (e) {
                            console.warn(e);
                        }
                    }, 1000);
                }

                if (percent > window.lastBufferPercent) {
                    window.lastBufferPercent = Math.min(percent, 99);
                    $("#progress").text(window.lastBufferPercent + "%");
                }
            }
        } catch(e) {
            console.error(e);
        }
    }

    castReceiverManager.start();

    // Disconnect if no senders
    window.castReceiverManager.onSenderDisconnected = function(event) {
    if(window.castReceiverManager.getSenders().length == 0 &&
        event.reason == cast.receiver.system.DisconnectReason.REQUESTED_BY_SENDER) {
            window.close();
        }
    }
};
