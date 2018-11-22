(function (window) {
    'use strict';

    const TYPE_URL = 0;
    const TYPE_ASS = 1;
    const TYPE_SRT = 2;

    const WORKER_URL = "sub/subtitles-octopus-worker.js";

    const DEFAULT_HEADER = "[V4+ Styles]\n"
            + "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
                    + "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, "
                    + "Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, "
                    + "Encoding\n"
            + "Style: Default,Serif,20,&H00FFFFFF,&H000000FF,&H00020713,&H00000000,-1,0,0,0,100,"
                    + "100,0,0,1,1.7,0,2,0,0,28,1\n"
            + "[Events]\n"
            + "Format: Start, End, Style, Text\n";

    class Track {
        constructor(trackName, opts) {
            this._name = trackName;
            this._type = TYPE_URL;
            this._pendingDialog = [];

            // Use the content if there is no url available
            if (!opts.subUrl) {
                this._type = opts.subContent && opts.subContent.includes("[Script Info]")
                        ? TYPE_ASS : TYPE_SRT;
                if (this._type == TYPE_SRT) {
                    opts.subContent = DEFAULT_HEADER;
                }
            }

            // Pass back this object in the ready function
            let readyFn = opts.onReady;
            opts.onReady = (() => {
                this._pendingDialog.forEach(this._instance.addDialogEvent);
                this._pendingDialog = [];
                readyFn(this);
            });
            this._instance = new window.SubtitlesOctopus(opts);
        }

        static get TYPE_ASS() {
            return TYPE_ASS;
        }

        static get TYPE_SRT() {
            return TYPE_SRT;
        }

        addDialogEvent(content) {
            if (this._type == TYPE_SRT) {
                content = this.__srt2ssa(content);
            }
            if (this._instance.workerActive) {
                this._instance.addDialogEvent(content);
            } else {
                // Not ready yet, add these after
                this._pendingDialog.push(content);
            }
        }

        setVisibility(visible) {
            this._instance.canvas.style.display = visible ? "block" : "none";
        }

        dispose() {
            this._instance.dispose();
        }

        get type() {
            return this._type;
        }

        get name() {
            this._name;
        }

        __srt2ssa(text) {
            var lines = text.split("\n");
            // Incase there is no number at the first line
            var timeLineOffset = lines[0].indexOf(" --> ") != -1 ? 0 : 1;
            var times = lines[timeLineOffset].replace(/,/gm, ".").split(" --> ");
            var dialogue = lines.slice(timeLineOffset + 1);
            return "Dialogue: " + times[0] + "," + times[1] + ",Default," + dialogue.join("\\N");
        }
    }

    class SubPlayer {
        constructor(videoEl, fontArray) {
            this.videoElement = videoEl;
            this.fonts = fontArray || [];

            // Defaults
            this.tracks = {};
            this.numberTracks = 0;
        }

        addFonts(fonts) {
            this.fonts = this.fonts.concat(fonts);
        }

        addFont(fontUrl) {
            this.fonts.push(fontUrl);
        }

        createTrack(name, opts) {
            return new Promise((res, rej) => {
                if (this.tracks.hasOwnProperty(name)) {
                    return res();
                }

                let options = {
                    video: this.videoElement,
                    fonts: this.fonts,
                    workerUrl: WORKER_URL,
                    onReady: (track => {
                        // Only set the first track as visible
                        track.setVisibility(this.numberTracks == 0);
                        this.numberTracks++;
                        res(track);
                    }),
                    onError: rej
                };
                if (opts != null) {
                    options = Object.assign(opts, options);
                }
                this.tracks[name] = new Track(name, options);
            });
        }

        getTrack(name) {
            return this.tracks[name];
        }

        hideAllTracks() {
            for (let name in this.tracks) {
                if (this.tracks.hasOwnProperty(name)) {
                    this.tracks[name].setVisibility(false)
                }
            }
        }

        selectTrack(name) {
            if (this.tracks.hasOwnProperty(name)) {
                this.hideAllTracks();
                this.tracks[name].setVisibility(true);
            }
        }

        reset() {
            for (let name in this.tracks) {
                if (this.tracks.hasOwnProperty(name)) {
                    this.tracks[name].dispose()
                }
            }
            this.tracks = {};
            this.fonts = [];
            this.numberTracks = 0;
        }
    }

    window.SubPlayer = SubPlayer;
}(window));
