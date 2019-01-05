class Preloader {
    constructor(maxCount) {
        this._queue = [];
        this._preloadCount = 0;
        this._maxCount = maxCount || 20;
        this._abort = false;
    }

    preload(src) {
        return new Promise((res, rej) => {
            if (this._abort) {
                return res();
            }
            if (this._preloadCount < this._maxCount) {
                this.__preload(res, rej, src);
            } else {
                this._queue.push({res: res, rej: rej, src: src});
            }
        });
    }

    reset() {
        this._queue = [];
        this._preloadCount = 0;
        this._abort = false;
    }

    abort() {
        this._abort = true;
    }

    get aborted() {
        return this._abort;
    }

    __preload(res, rej, src) {
        if (this._abort) {
            res();
            return;
        }
        this._preloadCount++;
        let image = new Image();
        image.onload = () => {
            res(image);
            this._preloadCount--;
            if (this._abort) {
                this._queue = [];
            } else if (this._queue.length > 0 && this._preloadCount < this._maxCount) {
                let item = this._queue.shift();
                this.__preload(item.res, item.rej, item.src);
            }
        }
        image.onerror = rej;
        image.src = src;
    }
}

class Caption {
    constructor(x, y, data) {
        this.x = x;
        this.y = y;
        this.data = data;
        this._image = new Image();
        this._preloaded = false;
        this._preloadRequested = false;
    }

    get hasPreloaded() {
        return this._preloaded;
    }

    preload(preloader) {
        if (!this._preloadRequested && !this._preloaded) {
            this._preloadRequested = true;
            return preloader.preload(this.data)
                .then(img => {
                    if (preloader.aborted) {
                        return;
                    }
                    this._image = img;
                    this._preloaded = true;
                    this.data = null;
                    return true;
                });
        }
        return Promise.resolve(false);
    }

    show(context2d) {
        if (this._preloaded && this._image) {
            context2d.drawImage(this._image, this.x, this.y);
            this._image = null;
        }
    }
}

class ClearRegion {
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
    }

    show(context2d) {
        context2d.clearRect(this.x, this.y, this.w, this.h);
    }
}

class Frame {
    constructor(time, count, resX, resY) {
        this.time = time;
        this.changeCount = count;
        this.resX = resX;
        this.resY = resY;
        this._captions = null;
        this._clearRegions = null;
        this._requestedPreload = false;

        this._tmpPreloadComplete = 0;
    }

    get isReady() {
        if (this.isClearFrame) {
            return true;
        }

        // Not all captions are added yet
        let changesReady = this._captions != null ? this._captions.length : 0;
        if (this._clearRegions != null) {
            changesReady += this._clearRegions.length;
        }
        if (changesReady < this.changeCount) {
            return false;
        }

        // Return true if each of the captions have finished
        if (this._captions != null) {
            for (let i = 0; i < this._captions.length; i++) {
                if (!this._captions[i].hasPreloaded) {
                    return false;
                }
            }
        }
        return true;
    }

    get isClearFrame() {
        return this.changeCount == 0;
    }

    add(x, y, data, preloader) {
        if (this._captions == null) {
            this._captions = [];
        }
        let caption = new Caption(x, y, data);
        this._captions.push(caption);
        if (this._requestedPreload) {
            caption.preload(preloader);
        }
    }

    addClearRegion(x, y, w, h) {
        if (this._clearRegions == null) {
            this._clearRegions = [];
        }
        let region = new ClearRegion(x, y, w, h);
        this._clearRegions.push(region);
    }

    preload(preloader) {
        if (!this._requestedPreload) {
            this._tmpStartTime = Date.now();
            this._requestedPreload = true;
            if (this._captions != null) {
                for (let i = 0; i < this._captions.length; i++) {
                    this._captions[i].preload(preloader);
                }
            }
        }
    }

    show(context2d) {
        if (this.isReady) {
            const canvas = context2d.canvas;
            if (this.changeCount == 0) {
                context2d.clearRect(0, 0, canvas.width, canvas.height);
            } else {
                if (this.resX > 0 && this.resY > 0 && (canvas.width != this.resX || canvas.height != this.resY)) {
                    canvas.width = this.resX;
                    canvas.height = this.resY;
                }
                if (this._clearRegions != null) {
                    this._clearRegions.forEach(c => c.show(context2d));
                }
                // Event to show the captions
                if (this._captions) {
                    this._captions.forEach(c => c.show(context2d));
                }
            }
            return true;
        }
        return false;
    }
}

class SubtitlePlayer {
    constructor(playerManager, requestDataFn, opts) {
        if (!opts) opts = {};
        this.canvas = opts.canvas || document.createElement('canvas');
        this._manager = playerManager;          // https://developers.google.com/cast/docs/reference/caf_receiver/cast.framework.PlayerManager#getCurrentTimeSec
        this._preloader = new Preloader(opts.maxPreloadCount || 20);
        this._context = this.canvas.getContext("2d");
        this._requestDataFn = requestDataFn;

        // State variables
        this._queue = [];
        this._currentSession = 0;
        this._finished = true;
        this._isPlaying = false;
        this._isSeeking = false;
        this._visible = true;
        this._lastAccurateRoutineTime = 0;
        this._lastAccurateCurrentTime = 0;
        this._lastReportedCurrentTime = 0;
        this._requestedData = false;
        this._lastRequestedMs = 0;

        // Options
        this._preloadAheadMs = opts.preloadAheadMs || 1500;
        this._timeShiftMs = opts.timeShiftMs || 0;
        this._bufferAheadMs = opts.bufferAheadMs || 3000;
        this._driftAheadThresholdMs = opts.driftAheadThresholdMs || 250;

        // Create canvas if not already created
        if (!opts.canvas) {
            document.body.appendChild(this.canvas);
        }

        this.random = Math.random();
    }

    reset() {
        this._finished = false;
        this._isPlaying = false;
        this._isSeeking = false;
        this._visible = true;
        this.__invalidateState();
    }

    // All frames should come in order
    processCaption(time, count, x, y, resX, resY, data) {
        if (this._finished) {
            return;
        }

        // Get the frame or create it if it doesn't exist
        let frame = this.__getOrAddFrame(time, count, resX, resY);
        if (!frame) {
            return;
        }

        // If the frame is behind but not within 1sec, we don't meed it, delete the frame
        let diff = this._manager.getCurrentTimeSec() * 1000 - frame.time;
        if (diff > 1000) {
            console.warn("Adding a frame that is super old, we should kill the queue right?", frame.time, "vs", this._manager.getCurrentTimeSec() * 1000);         // TODO maybe add a small difference in case we are about to show the subtitles
            if (this._queue.length > 0 && this._queue[this._queue.length - 1].time == time) {
                this._queue.pop();
            }
            return;
        }

        // Add new data to this frame
        frame.add(x, y, data, this._preloader);
    }

    processClearRegion(time, count, x, y, w, h) {
        if (this._finished) {
            return;
        }

        // Get the frame or create it if it doesn't exist
        let frame = this.__getOrAddFrame(time, count);
        if (!frame) {
            return;
        }
        frame.addClearRegion(x, y, w, h);
    }

    processWipe(time) {
        if (this._finished) {
            return;
        }
        this._queue.push(new Frame(time, 0));
    }

    runRoutine(timestamp) {
        if (this._finished || !this._visible) {
            return false;
        }

        // Display Routine
        let timeMs = this.__estimatePlayTime();
        let lastReadyFrameIndex = -1;
        let lastClearFrameIndex = -1;
        let lastUnReadyFrameIndex = -1;

        // Search for the latest ready frame to show
        for (let i = 0; i < this._queue.length; i++) {
            let frame = this._queue[i];
            if (frame.time + this._timeShiftMs > timeMs) {
                // Found a future frame to show, let's get out
                break;
            }

            if (frame.isClearFrame) {
                lastClearFrameIndex = i;
            }

            // Found the last frame that is ready and not ready
            if (frame.isReady) {
                lastReadyFrameIndex = i;
            } else {
                lastUnReadyFrameIndex = i;
            }
        }

        if (lastReadyFrameIndex != -1) {
            // Show all the frames even if we skip some
            for (let i = Math.max(lastClearFrameIndex, 0); i <= lastReadyFrameIndex; i++) {
                this._queue[i].show(this._context);
            }

            // Remove either everything up to the shown frame, or if running late, remove up to the last non ready frame
            this._queue = this._queue.splice(Math.max(lastReadyFrameIndex + 1, lastUnReadyFrameIndex));
        }

        // Preload Routine
        let preloadTimeMs = timeMs + this._preloadAheadMs;
        for (let i = 0; i < this._queue.length; i++) {
            let frame = this._queue[i];
            if (frame.time > preloadTimeMs) {
                break;
            }
            frame.preload(this._preloader);
        }

        // Check if we need to request for more data
        let diff = this._lastRequestedMs - timeMs;
        if (diff < this._bufferAheadMs) {
            if (diff < 0 && this._lastRequestedMs > this._bufferAheadMs) {
                console.warn("Severely under running!! Requesting takes tooo long!!!");     // TODO remove later, log
            }
            // Request data, wait for the promise
            this.__requestData();
        }
        return (this._isPlaying || this._isSeeking) && this._visible;
    }

    seekOccurred(timeMs) {
        this.setPlayState(false);
        this._isSeeking = true;
        this.__invalidate(timeMs);
    }

    invalidate() {
        this.__invalidate(this._manager.getCurrentTimeSec() * 1000);
    }

    setPlayState(flag) {
        this._isPlaying = flag;
        if (flag) {
            this._isSeeking = false;
        }
    }

    setVisible(flag) {
        if (this._visible != flag) {
            this._visible = flag;
            if (this._visible) {
                this.invalidate();
            } else {
                this.clearScreen();
            }
        }
    }

    finish() {
        if (!this._finished) {
            this._finished = true;
            this._preloader.abort();
            this.clearScreen();
        }
    }

    clearScreen() {
        this._context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    get finished() {
        return this._finished;
    }

    get sessionId() {
        return this._currentSession;
    }

    get isPlaying() {
        return this._isPlaying;
    }

    get isSeeking() {
        return this._isSeeking;
    }

    get isVisible() {
        return this._visible;
    }

    __estimatePlayTime() {
         // Display Routine
        let reportedTime = this._manager.getCurrentTimeSec() * 1000;
        let timeMs = reportedTime;
        let now = Date.now();

        // Adjust the play time if it stalls
        if (this._lastAccurateRoutineTime == 0 || !this._isPlaying) {
            this._lastAccurateRoutineTime = now;
            this._lastAccurateCurrentTime = timeMs;
        } else {
            // See if projected time is faster than reported time, use that instead
            let difference = now - this._lastAccurateRoutineTime;
            let projectedTime = difference + this._lastAccurateCurrentTime;

            // Calculate how far the projected time is from reported time, if too far and last current time
            // has changed, then correct the drift by returning to a possibly accurate play time
            let driftTime = projectedTime - reportedTime;
            if (driftTime < 0 || (driftTime > this._driftAheadThresholdMs && reportedTime != this._lastReportedCurrentTime)) {
                // The player gave us a correct approximated play time (10ms error of margin)
                this._lastAccurateCurrentTime = timeMs;
                this._lastAccurateRoutineTime = now;
            } else {
                // The player is still falling behind in giving us correct play time
                timeMs = projectedTime;
            }
        }
        this._lastReportedCurrentTime = this._bufferAheadMs;
        return timeMs;
    }

    __getOrAddFrame(time, count, resX, resY) {
        let lastFrame = this._queue.length > 0 ? this._queue[this._queue.length - 1] : null;
        if (lastFrame && lastFrame.time == time) {
            return lastFrame;
        } else if (lastFrame && lastFrame.time > time) {
            console.error("Frames came in out of order, this is bad");
        } else {
            // Create new frame
            let frame = new Frame(time, count, resX || 0, resY || 0);
            this._queue.push(frame);
            return frame;
        }
        return null;
    }

    __requestData() {
        if (!this._requestedData && this._visible) {
            this._requestDataFn(this._lastRequestedMs, this._bufferAheadMs, this._currentSession)
                    .then(() => { this._requestedData = false })
                    .catch(console.warn);
            this._requestedData = true;
            this._lastRequestedMs += this._bufferAheadMs;
        }
    }

     __invalidate(timeMs) {
        this.__invalidateState();
        this.clearScreen();
        this._requestedData = false;
        this._lastRequestedMs = timeMs;

        // Session changed from invalidating
        if (this._currentSession == Number.MAX_SAFE_INTEGER) {
            this._currentSession = 0;
        } else {
            this._currentSession++;
        }
        this.__requestData();
    }

    __invalidateState() {
        this._queue.splice(0, this._queue.length);
        this._preloader.reset();
        this._lastAccurateRoutineTime = 0;
        this._lastAccurateCurrentTime = 0;
        this._lastReportedCurrentTime = 0;
        this._requestedData = false;
        this._lastRequestedMs = 0;
    }
}

class CastSubtitlePlayer {
    constructor(context, opts) {
        if (!opts) opts = {};
        const manager = context.getPlayerManager();
        this._context = context;
        this._player = new SubtitlePlayer(manager, this.__requestData.bind(this), opts);
        this._channel = opts.channel || 'urn:x-cast:com.melonpan.messages';

        // State variables
        this._senderId = null;
        this._currentChunkData = "";
        this._requestResolver = null;
        this._progress = 0;

        // Preload variables
        this._isPreloading = false;
        this._preloadCanvas = document.createElement('canvas');
        this._preloadContext = this._preloadCanvas.getContext('2d');
        this._preloadCanvas.width = 1920;
        this._preloadCanvas.height = 1080;
        document.body.appendChild(this._preloadCanvas);
        this._preloadContext.textAlign = "end";
        this._preloadContext.textBaseline = "top";
        this._fadeAnimator = new Animator(40, 20, false, (index, num) => {
            this._preloadContext.globalAlpha = index / num;
        });
        this._hanaAnimator = new ImageAnimation(this._preloadContext, [
                "images/hana/base.jpg",
                "images/hana/0.jpg",
                "images/hana/1.jpg",
                "images/hana/2.jpg",
                "images/hana/3.jpg",
                "images/hana/4.jpg",
            ], (this._preloadCanvas.width - 367) / 2, this._preloadCanvas.height - 484, 82, 196, 120);
        this._hanaAnimator.preload();

        // Player events - https://developers.google.com/cast/docs/reference/caf_receiver/cast.framework.events#.EventType
        // castContext.getPlayerManager().addEventListener(cast.framework.events.EventType.ALL, events);
        manager.addEventListener(cast.framework.events.EventType.REQUEST_LOAD, this.__eventHandler.bind(this));
        manager.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, this.__eventHandler.bind(this));
        manager.addEventListener(cast.framework.events.EventType.BUFFERING, this.__eventHandler.bind(this));
        manager.addEventListener(cast.framework.events.EventType.REQUEST_STOP, this.__eventHandler.bind(this));
        manager.addEventListener(cast.framework.events.EventType.SEEKING, this.__eventHandler.bind(this));
        manager.addEventListener(cast.framework.events.EventType.PLAYING, this.__eventHandler.bind(this));
        manager.addEventListener(cast.framework.events.EventType.PAUSE, this.__eventHandler.bind(this));

        context.addCustomMessageListener(this._channel, (event) => {
            if (event.type == "message" && event.data) {
                this.__messageHandler(event.data);
            }
        });
    }

    __mainloop() {
        let ret;
        if (this._isPreloading) {
            ret = true;

            // Run the animation loop
            if (this._fadeAnimator.update()) {
                this._preloadContext.fillStyle = "black";
                this.__clearLoadingCanvas();
                this._preloadContext.fillRect(0, 0, this._preloadCanvas.width, this._preloadCanvas.height);
                this.__updateLoadingText();
                this._hanaAnimator.update(true);
            } else {
                this._hanaAnimator.update();
            }
        } else {
             ret = this._player.runRoutine();
        }

        if (ret) {
            window.requestAnimationFrame(this.__mainloop.bind(this));
        }
    }

    __requestData(timeMs, durationMs, sessionId) {
        return new Promise((res, rej) => {
            if (this._senderId != null) {
                this._context.sendCustomMessage(this._channel, this._senderId, JSON.stringify({
                    action: "request",
                    time: timeMs,
                    session: sessionId,
                    seeking: this._player.isSeeking,
                    duration: durationMs
                }));
                this._requestResolver = res;
            } else {
                rej("No sender id");
            }
        });
    }

    __eventHandler(event) {
        console.log(event.type, event);
        switch(event.type) {
            case "REQUEST_LOAD":
                this._isPreloading = false;
                this.__clearLoadingCanvas();
                this._senderId = event.senderId;
                this._player.reset();
                break;
            case "MEDIA_FINISHED":
                this._isPreloading = false;
                this._senderId = null;
                this._player.finish();
                break;
            case "REQUEST_STOP":
                this._player.finish();
                break;
            case "BUFFERING":
                this._player.setPlayState(!event.isBuffering);
                if (!event.isBuffering) {
                    window.requestAnimationFrame(this.__mainloop.bind(this));
                }
                break;
            case "PLAYING":
                this._player.setPlayState(true);
                window.requestAnimationFrame(this.__mainloop.bind(this));
                this.__clearLoadingCanvas();
                break;
            case "PAUSE":
                this._player.setPlayState(false);
                break;
            case "SEEKING":
                this._player.seekOccurred(event.currentMediaTime * 1000);
                break;
            default:
                // console.log(event);
                break;
        }
    }

    __messageHandler(event) {
        console.log(event.action, event);
        switch(event.action) {
            case "subtitle.preload":
                if (event.session == this._player.sessionId) {
                    if (event.done) {
                        this._requestResolver();
                        this._requestResolver = null;
                    } else if (event.chunked) {
                        // Passing data that is too large for the message stream, will be chunked
                        this._currentChunkData = this._currentChunkData + event.data;
                        if (event.last) {
                            // All the data that was chunked has been received
                            this._player.processCaption(event.time, event.count, event.x, event.y, event.resX, event.resY, this._currentChunkData);
                            this._currentChunkData = "";
                        }
                    } else {
                        this._player.processCaption(event.time, event.count, event.x, event.y, event.resX, event.resY, event.data);
                    }
                }
                break;
            case "subtitle.clear":
                if (event.session == this._player.sessionId) {
                    if (event.w && event.h) {
                        this._player.processClearRegion(event.time, event.count, event.x, event.y, event.w, event.h);
                    } else {
                        this._player.processWipe(event.time);
                    }
                }
                break;
            case "subtitles.change":
                if (this._player.isVisible != event.show) {
                    this._player.setVisible(event.show);
                    if ((this._player.isPlaying || this._player.isSeeking) && this._player.isVisible) {
                        window.requestAnimationFrame(this.__mainloop.bind(this));
                    }
                } else {
                    this._player.invalidate();
                }
                break;
            case "buffer.start":
                break;
            case "buffer.precentage":
                this._progress = event.percentage;
                if (!this._player.isPlaying) {
                    this.__updateLoadingText();
                }
                break;
            case "preload.stream":
                this._player.reset();
                this._fadeAnimator.reset();
                this._progress = 0;
                this._isPreloading = true;
                window.requestAnimationFrame(this.__mainloop.bind(this));
                break;
            case "player.hide":
                this._isPreloading = false;
                this._player.finish();
                this.__clearLoadingCanvas();
                break;
            default:
                // console.log(event)
                break;
        }
    }

    __clearLoadingCanvas() {
        this._preloadContext.clearRect(0, 0, this._preloadCanvas.width, this._preloadCanvas.height);
    }

    __updateLoadingText() {
        const fontSize = 100;
        const x = 1068;
        const y = 400;
        const color = this._preloadContext.fillStyle;
        const shadowColor = this._preloadContext.shadowColor;
        const shadowBlur = this._preloadContext.shadowBlur;
        this._preloadContext.clearRect(0, y, this._preloadCanvas.width, fontSize);
        if (this._isPreloading) {
            this._preloadContext.fillStyle = "black";
            this._preloadContext.fillRect(0, y, this._preloadCanvas.width, fontSize);
        }
        this._preloadContext.shadowColor = "rgba(0,0,0,0.3)";
        this._preloadContext.shadowBlur = 10;
        this._preloadContext.fillStyle = "white";
        this._preloadContext.font = fontSize + "px Nunito Sans";
        this._preloadContext.fillText(Math.min(this._progress, 99) + "%", x, y);
        this._preloadContext.fillStyle = color;
        this._preloadContext.shadowColor = shadowColor;
        this._preloadContext.shadowBlur = shadowBlur;
    }
}

const castContext = cast.framework.CastReceiverContext.getInstance();

const MAX_PRELOAD_COUNT = 15;
const REQUEST_AHEAD_TIME_MS = 4000;
const PRELOAD_AHEAD_TIME_MS = 2500;
const DRIFT_AHEAD_THRESHOLD = 300;
const FRAME_TIME_SHOW_OFFSET = -50;

const castPlayer = new CastSubtitlePlayer(castContext, {
    preloadAheadMs: PRELOAD_AHEAD_TIME_MS,
    timeShiftMs: FRAME_TIME_SHOW_OFFSET,
    bufferAheadMs: REQUEST_AHEAD_TIME_MS,
    driftAheadThresholdMs: DRIFT_AHEAD_THRESHOLD,
    maxPreloadCount: MAX_PRELOAD_COUNT
});

const options = new cast.framework.CastReceiverOptions();
options.maxInactivity = 3600; //Development only
castContext.start(options);
