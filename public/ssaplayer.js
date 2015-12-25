(function (window) {
    'use strict';

    var frontZIndex = 2147483647;
    var SRTDialogSpecifier = ["Start", "End", "Style", "Text"];
    var TypeSSA = 0;
    var TypeSRT = 1;

    /**
     *  Track class
     *      Contains information for each subtitle track
     */
    function Track(type, name, video, overlay, clock) {
        this.type = type;           // SSA or SRT
        this.name = name;           // Track Name
        this.video = video;         // VideoHtmlElement
        this.overlay = overlay;     // libjass wrapper
        this.clock = clock;         // Video clock
        this.renderer = null;       // WebRenderer
    }

    Track.prototype.resize = function() {
        if (!this.renderer) return;

        var sublEl = this.overlay.childNodes[0];
        if (!document.fullscreenElement && !document.mozFullScreenElement
                && !document.webkitFullscreenElement && !document.msFullscreenElement) {
            this.renderer.resize(this.video.offsetWidth, this.video.offsetHeight);
            this.overlay.style.height = this.video.offsetHeight + 'px';
            if (sublEl.className.indexOf("libjass-subs") != -1) {
                sublEl.style.position = "static";
                sublEl.style.zIndex = null;
            }
        } else {
            if (sublEl.className.indexOf("libjass-subs") != -1) {
                sublEl.style.position = "absolute";
                sublEl.style.zIndex = frontZIndex;   // Higher than default fullscreen
            }
            this.renderer.resize(screen.width, screen.height);
            this.overlay.style.height = screen.height + 'px';
            this.overlay.style.right = 0;
            this.overlay.style.bottom = 0;
        }
    }

    Track.prototype.getClassName = function() {
        return this.name.replace(/[.,-\/#!$%\^&\*;:\[\]{}=\-_`~()]/g,"")
            .replace(/\s+/mg, "-").toLowerCase() + " " + (this.type == TypeSSA ? "ssa" : "srt");
    }

    /**
     *  SSAPlayer Definition
     *      Call by         window.SSAPlayer({video: videoElement, subs})
     */
    var libjass = window.libjass;
    window.SSAPlayer = function() {
        this.video = null;
        this.wrapper = null;
        this.clock = null;
        this.renderSettings = new libjass.renderers.RendererSettings();
        this.tracks = {};
        this.trackCount = 0;
        this.renderSettings.enableSvg = true;
        this.renderSettings.preciseOutlines = true;

        this.__events = {
            'videoinit': null,
            'updatedisplay': null
        };

        var defaults = {
            video: null,
            subs: null,
        };

        // Options
        if (arguments[0] && typeof arguments[0] === "object") {
            // Validate inputs
            if (!arguments[0].video) {
                throw new Error("Did not pass a video element as an object key, ex: {video: videoElement}");
            }
            this.options = extendDefaults(defaults, arguments[0]);

            // Init
            this.video = this.options.video;
            this.wrapper = wrap(this.video);
            this.wrapper.style.position = "relative";

            // Load video and clock
            this.clock = new libjass.renderers.VideoClock(this.video);
            this.__events.videoinit = videoLoadedInit.bind(this);
            this.video.addEventListener("loadedmetadata", this.__events.videoinit, false);

            if (arguments[0].subs) {
                for (var i = 0; i < arguments[0].subs.length; i++) {
                    var name = arguments[0].subs[i].name;
                    if (this.tracks[name]) {
                        throw new Error("There is a repeated subtitle track name");
                    }
                    var src = arguments[0].subs[i].src;
                    var type = src && src.trim().indexOf("[Script Info]") == 0 ? TypeSSA : TypeSRT;
                    createNewTrack.call(this, type, name);
                }
            } else {
                this.options.subs = [];
            }

            if (this.video.readyState >= 4) {
                videoLoadedInit.call(this);
            }
        }
    }

    // Show a track by its track name
    SSAPlayer.prototype.selectTrack = function(name) {
        for (var n in this.tracks) {
            if (n != name) {
                this.tracks[n].overlay.style.zIndex = -1;
            }
        }
        if (this.tracks[name]) {
            this.tracks[name].overlay.style.zIndex = frontZIndex;
        }
    }

    // Add subtitles to a track
    SSAPlayer.prototype.addSubtitleEvent = function(name, line) {
        var self = this;
        if (this.tracks.hasOwnProperty(name)) {
            if (line.indexOf(" --> ") != -1) {
                // Convert SRT lines into SSA
                line = srt2ssa(line);
            }

            if (this.tracks[name].renderer) {
                this.tracks[name].renderer.ass.addEvent(line);
            } else {
                if (!this.tracks[name].beforeList) {
                    this.tracks[name].beforeList = [];
                }
                this.tracks[name].beforeList.push(line);
            }
        } else {
            // New Track with no header, which means we just added an SRT subtitle event
            var track = createNewTrack.call(this, TypeSRT, name);
            libjass.ASS.fromString("", TypeSRT).then(function(ssa) {
                ssa.dialoguesFormatSpecifier = SRTDialogSpecifier;
                this.renderer = createRenderer.call(this, ssa);
                ssa.addEvent(srt2ssa(line));
                updateDisplayArea.call(self);
            }.bind(track));
        }
    }

    // Create a new track, must include data
    SSAPlayer.prototype.newTrack = function(name, data) {
        var self = this;
        if (!name) {
            throw new Error("Creating new track must have a name");
        }
        if (this.tracks[name]) {
            throw new Error("Subtitle of name '" + name + "' already exists, overriding.");
        }
        if (!data || data.trim().length == 0) {
            throw new Error("To create a new track using newTrack(), you must specify data");
        }

        var type = data.trim().indexOf("[Script Info]") == 0 ? TypeSSA : TypeSRT;
        var track = createNewTrack.call(this, type, name);

        if (this.video.readyState < 4) {
            this.options.subs.push({name: name, src: data})
            return;
        }

        libjass.ASS.fromString(data, type).then(function(ssa) {
            if (this.type == TypeSRT) {
                ssa.dialoguesFormatSpecifier = SRTDialogSpecifier;
            }
            this.renderer = createRenderer.call(this, ssa);
            if (this.beforeList) {
                for (var j = 0; j < this.beforeList.length; j++) {
                    ssa.addEvent(this.beforeList[j]);
                }
            }
            updateDisplayArea.call(self);
        }.bind(track));
    }

    // Remove the player instance
    SSAPlayer.prototype.remove = function() {
        this.wrapper.parentNode.insertBefore(this.video, this.wrapper);
        this.wrapper.parentNode.removeChild(this.wrapper);

        // Remove events
        this.video.removeEventListener('loadedmetadata', this.__events.videoinit, false);
        this.video.removeEventListener('resize', this.__events.updatedisplay, false);
        if (typeof document.fullScreen !== "undefined") {
            this.video.removeEventListener('fullscreenchange', this.__events.updatedisplay, false);
        } else if (typeof document.webkitIsFullScreen !== "undefined") {
            this.video.removeEventListener('webkitfullscreenchange', this.__events.updatedisplay, false);
        } else if (typeof document.mozFullScreen !== "undefined") {
            this.video.removeEventListener('mozfullscreenchange', this.__events.updatedisplay, false);
        }
        this.__events.updatedisplay = null;
        this.__events.videoinit = null;

        // Set all variables to nothing
        this.video = null;
        this.wrapper = null;
        this.clock = null;
        this.renderSettings = null;
        this.tracks = null;
        this.trackCount = 0;
        this.renderSettings = null;
    }

    /**
     *  Private Methods
     */
    // Once the video loads, we will run the following
    function videoLoadedInit() {
        this.video.removeEventListener('loadedmetadata', this.__events.videoinit, false);

        if (this.options.subs.length) {
            // Load subs
            var promises = [];
            for (var i = 0; i < this.options.subs.length; i++) {
                var data = this.options.subs[i];
                if (!data.name) {
                    throw new Error("Subtitle entry does not have a name.");
                }
                var src = !data.src || data.src.trim().length == 0 ? "" : data.src;
                promises.push(libjass.ASS.fromString(src, this.tracks[data.name].type).then(function(ssa) {
                    if (this.type == TypeSRT) {
                        ssa.dialoguesFormatSpecifier = SRTDialogSpecifier;
                    }
                    this.renderer = createRenderer.call(this, ssa);

                    // Add any pending subtitles
                    if (this.beforeList) {
                        for (var j = 0; j < this.beforeList.length; j++) {
                            ssa.addEvent(this.beforeList[j]);
                        }
                    }
                }.bind(this.tracks[data.name])));
            }

            libjass.Promise.all(promises).then(function() {
                updateDisplayArea.call(this);
            }.bind(this));

        } else {
            updateDisplayArea.call(this);
        }

        // Set Events
        this.__events.updatedisplay = updateDisplayArea.bind(this);
        this.video.addEventListener('resize', this.__events.updatedisplay, false);

        // Fullscreen
        if (typeof document.fullScreen !== "undefined") {
            this.video.addEventListener('fullscreenchange', this.__events.updatedisplay, false);
        } else if (typeof document.webkitIsFullScreen !== "undefined") {
            this.video.addEventListener('webkitfullscreenchange', this.__events.updatedisplay, false);
        } else if (typeof document.mozFullScreen !== "undefined") {
            this.video.addEventListener('mozfullscreenchange', this.__events.updatedisplay, false);
        }
    }

    function createRenderer(ssa) {
        return new libjass.renderers.WebRenderer(ssa, this.clock, this.overlay, this.renderSettings);
    }

    function createNewTrack(type, name) {
        var overlay = document.createElement("div");
        overlay.style.pointerEvents = "none";
        overlay.style.position = "absolute";
        overlay.style.top = 0;
        overlay.style.left = 0;
        this.wrapper.appendChild(overlay);
        var track = this.tracks[name] = new Track(type, name, this.video, overlay, this.clock);
        overlay.className = track.getClassName();
        if (this.trackCount++ > 0) {
            overlay.style.zIndex = -1;
        } else {
            overlay.style.zIndex = frontZIndex;
        }
        return track;
    }

    // Converts srt entry to ssa entry
    function srt2ssa(input) {
        var lines = input.split("\n");
        var timeLineOffset = lines[0].indexOf(" --> ") != -1 ? 0 : 1;       // Incase there is no number at the first line
        var times = lines[timeLineOffset].replace(/,/gm, ".").split(" --> ");
        var dialog = lines.slice(timeLineOffset + 1);
        return "Dialogue: " + times[0] + "," + times[1] + ",Default," + dialog.join("\\N");
    }

    // Resize all tracks
    function updateDisplayArea() {
        for (var name in this.tracks) {
            this.tracks[name].resize();
        }
    }

    // Utility Functions
    function wrap(toWrap, wrapper) {
        wrapper = wrapper || document.createElement('div');
        if (toWrap.nextSibling) {
            toWrap.parentNode.insertBefore(wrapper, toWrap.nextSibling);
        } else {
            toWrap.parentNode.appendChild(wrapper);
        }
        wrapper.appendChild(toWrap);
        return wrapper;
    };

    function extendDefaults(source, properties) {
        for (var property in properties) {
            if (properties.hasOwnProperty(property)) {
                source[property] = properties[property];
            }
        }
        return source;
    }
}(window));
