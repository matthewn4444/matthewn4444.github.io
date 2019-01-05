class Animator {
    constructor(intervals, stepMs, loop, fn) {
        this.intervals = intervals;
        this.step = stepMs;
        this.loop = loop;
        this._index = 0;
        this._startTime = 0;
        this._fn = fn;
        this._finished = false;
    }

    update() {
        if (this._startTime == 0) {
            // First frame
            this._startTime = Date.now();
            this._fn(0, this.intervals);
            return true;
        }

        let frameIndex = Math.floor((Date.now() - this._startTime) / this.step);
        if (!this.loop && frameIndex > this.intervals) {
            // Finished
            if (!this._finished) {
                this._fn(this.intervals, this.intervals);
                this._finished = true;
                return true;
            }
            return false;
        }
        let index = Math.floor(frameIndex % this.intervals);
        if (index > this._index || this.loop && index != this._index) {
            this._fn(index, this.intervals);
            this._index = index;
            return true;
        }
        return false;
    }

    reset() {
        this._index = 0;
        this._startTime = 0;
        this._finished = false;
    }

    get index() {
        return this._index;
    }
}

class ImageAnimation {
    constructor(context, srcs, x, y, offsetX, offsetY, stepMs) {
        this.x = x;
        this.y = y;
        this._animator = new Animator(srcs.length - 1, stepMs, true, this.__drawFrame.bind(this));
        this.context = context;
        this.baseImg;
        this.frames;

        this._baseSrc = srcs.shift();
        this._frameSrcs = srcs.concat();
        this._offsetX = offsetX + x;
        this._offsetY = offsetY + y;
    }

    preload() {
        return new Promise((res, rej) => {
             let loader = [ this.__preload(this._baseSrc) ];
            for (let i = 0; i < this._frameSrcs.length; i++) {
                loader.push(this.__preload(this._frameSrcs[i]))
            }
            return Promise.all(loader)
                .then(data => {
                    this.baseImg = data.shift();
                    this.frames = data;
                    res();
                });
        });
    }

    update(force) {
        if (this.frames == null) {
            return;
        }
        let ret = this._animator.update();
        if (!ret && force) {
            // Force draw same image
            this.__drawFrame(this._animator.index);
        }
        return ret;
    }

    __drawFrame(index) {
        this.__drawImage(this.baseImg, this.x, this.y);
        this.__drawImage(this.frames[index], this._offsetX, this._offsetY);
    }

    __drawImage(img, x, y) {
        this.context.clearRect(x, y, img.width, img.height)
        this.context.drawImage(img, x, y);
    }

    __preload(src) {
        return new Promise((res, rej) => {
            let img = new Image();
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = src;
        });
    }
}
