(function (window) {
    'use strict';

    var libjass = window.libjass;

    function Track(video, name, data, overlay) {
        this.ass;
        this.renderer;
        this.video = video;
        this.wrapper = document.createElement("div");
        this.name = name;
        this.className = this.name.toLowerCase().trim().replace("\\s", "_");
        this.type = data && data.includes("[Script Info]") ? Track.Type.ASS : Track.Type.SRT;

        // Create the renderer and the string
        this.pendingDialogues = [];
        this.pendingEnabledState = true;
        this.wrapper.style.zIndex = 2147483647;
        this.wrapper.style.position = "absolute";
        this.wrapper.style.top = 0;
        this.wrapper.style.left = 0;
        overlay.appendChild(this.wrapper);

        libjass.ASS.fromString(data ? data : "", this.type).then(function(ass) {
            if (this.type == Track.Type.SRT) {
                ass.dialoguesFormatSpecifier = ["Start", "End", "Style", "Text"];
            }
            this.ass = ass;
            if (!this.renderer) {
                this.__initRenderer();
            }
        }.bind(this));
    }
    Track.Type = {
        ASS: "ass",
        SRT: "srt",
    };
    Track.prototype.__initRenderer = function() {
        if (this.ass && this.video.readyState == 4) {
            this.renderer = new libjass.renderers.WebRenderer(this.ass, new libjass.renderers.VideoClock(this.video), this.wrapper, {});
            this.wrapper.className = "libjass-track " + this.className;

            // Do all the pending work
            this.pendingDialogues.forEach(function(dialogue, i) {
                this.__addDialogueEvent(dialogue);
            }.bind(this));
            this.setEnabled(this.pendingEnabledState);
            this.pendingDialogues = null;
            this.__resize();
        }
    }
    Track.prototype.__srt2ssa = function(input) {
        var lines = input.split("\n");
        var timeLineOffset = lines[0].indexOf(" --> ") != -1 ? 0 : 1;       // Incase there is no number at the first line
        var times = lines[timeLineOffset].replace(/,/gm, ".").split(" --> ");
        var dialogue = lines.slice(timeLineOffset + 1);
        return "Dialogue: " + times[0] + "," + times[1] + ",Default," + dialogue.join("\\N");
    }
    Track.prototype.__addDialogueEvent = function(dialogue) {
        if (this.type == Track.Type.SRT) {
            dialogue = this.__srt2ssa(dialogue);
        }
        this.renderer.ass.addEvent(dialogue);
        return this;
    }
    Track.prototype.__resize = function() {
        if (!this.renderer) {
            return;
        }
        var videoWidth = this.video.videoWidth;
        var videoHeight = this.video.videoHeight;
        var videoOffsetWidth = this.video.offsetWidth;
        var videoOffsetHeight = this.video.offsetHeight;
        var ratio = Math.min(videoOffsetWidth / videoWidth, videoOffsetHeight / videoHeight);
        var subsWrapperWidth = videoWidth * ratio;
        var subsWrapperHeight = videoHeight * ratio;
        var subsWrapperLeft = (videoOffsetWidth - subsWrapperWidth) / 2;
        var subsWrapperTop = (videoOffsetHeight - subsWrapperHeight) / 2;
        this.renderer.resize(subsWrapperWidth, subsWrapperHeight, subsWrapperLeft, subsWrapperTop);
    }
    Track.prototype.addDialogue = function(dialogue) {
        if (this.renderer) {
            this.__addDialogueEvent(dialogue);
        } else {
            if (!this.pendingDialogues) {
                throw new Error("You did not run createTrack before trying to add dialogue.");
            }
            this.pendingDialogues.push(dialogue);
        }
        return this;
    }
    Track.prototype.setEnabled = function(flag) {
        if (this.renderer) {
            if (flag) {
                this.renderer.enable();
            } else {
                this.renderer.disable();
            }
        } else {
            this.pendingEnabledState = flag;
        }
        return this;
    }
    Track.prototype.isEnabled = function() {
        return this.renderer ? this.renderer.enabled : this.pendingEnabledState;
    }

    window.SubPlayer = function(video) {
        this.pendingTracks;
        this.video = video;
        this.wrapper = document.createElement("div");
        this.tracks = {};
        this.__videoReadyFn = null;

        // Attach events
        if (typeof document.fullScreen !== "undefined") {
            this.video.addEventListener('fullscreenchange', this.__resize.bind(this), false);
        } else if (typeof document.webkitIsFullScreen !== "undefined") {
            this.video.addEventListener('webkitfullscreenchange', this.__resize.bind(this), false);
        } else if (typeof document.mozFullScreen !== "undefined") {
            this.video.addEventListener('mozfullscreenchange', this.__resize.bind(this), false);
        }

        // Setup wrapper
        this.wrapper.className = "libjass-wrapper";
        this.video.parentNode.replaceChild(this.wrapper, this.video);
        this.wrapper.appendChild(this.video);

        // If video is not loaded yet, save the track creation till later
        if (this.video.readyState != 4) {
            this.pendingTracks = [];
            this.__videoReadyFn = this.__videoReady.bind(this);
            this.video.addEventListener("loadeddata", this.__videoReadyFn);
        }
    }
    SubPlayer.prototype.__videoReady = function() {
        if (this.video) {
            this.video.removeEventListener("loadeddata", this.__videoReadyFn);
            if (this.video.readyState != 4) {
                throw new Error("Video is incorrect state even though it loaded its data");
            }
            this.pendingTracks.forEach(function(name) {
                this.tracks[name].__initRenderer();
            }.bind(this));
            this.pendingTracks = null;
        }
    }
    SubPlayer.prototype.__resize = function() {
        for (var n in this.tracks) {
            this.tracks[n].__resize();
        }
    }
    SubPlayer.prototype.createTrack = function(name, data) {
        if (this.tracks.hasOwnProperty(name)) {
            console.warn("Cannot create track that already exists; name = '" + name + "'");
            return this.tracks[name];
        } else {
            var track = new Track(this.video, name, data, this.wrapper);
            this.tracks[name] = track;

            if (this.video.readyState != 4) {
                // If video is not loaded yet, init the renderer later
                this.pendingTracks.push(name);
            }
            return track;
        }
    }
    SubPlayer.prototype.addDialogue = function(name, dialogue) {
        if (this.tracks.hasOwnProperty(name)) {
            this.tracks[name].addDialogue(dialogue);
        } else {
            throw new Error("Cannot add dialogue to a track that doesnt exist! ['" + name + "']");
        }
    }
    SubPlayer.prototype.setEnabledTrackState = function(name, flag) {
        if (this.tracks.hasOwnProperty(name)) {
            this.tracks[name].setEnabled(flag);
        }
    }
    SubPlayer.prototype.selectTrack = function(name) {
        for (var n in this.tracks) {
            this.tracks[n].setEnabled(false);
        }
        if (name) {
            this.setEnabledTrackState(name, true);
        }
    }
    SubPlayer.prototype.getTrack = function(name) {
        return this.tracks[name];
    }
    SubPlayer.prototype.destroy = function() {
        // Remove the added elements by libjass
        var parent = this.wrapper.parentNode;
        parent.insertBefore(this.video, this.wrapper);
        this.wrapper.remove();

        // Remove Events
        this.video.removeEventListener("loadeddata", this.__videoReady.bind(this), false);
        if (typeof document.fullScreen !== "undefined") {
            this.video.removeEventListener('fullscreenchange', this.__resize.bind(this), false);
        } else if (typeof document.webkitIsFullScreen !== "undefined") {
            this.video.removeEventListener('webkitfullscreenchange', this.__resize.bind(this), false);
        } else if (typeof document.mozFullScreen !== "undefined") {
            this.video.removeEventListener('mozfullscreenchange', this.__resize.bind(this), false);
        }

        // Remove data
        this.video = null;
        this.tracks = null;
    }
}(window));
