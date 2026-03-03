import { Streamable } from "./Streamable.js";

/**
 * A Streamable that plays incoming audio data using the Web Audio API.
 */
class PlayAudioStreamable extends Streamable {
    constructor() {
        super();
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: "interactive",
            sampleRate: 44100,
        });

        this.channels = 2;
        this.streamSampleRate = 44100;
        this.nextStartTime = 0;
        this.bufferAheadTime = 1; // 1s buffer
        this.scheduledUntil = 0;

        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.audioContext.destination);

        this.debug = false;
        this._dbgChunks = 0;
        this._dbgFrames = 0;
        this._dbgLastTs = performance.now();
        this._dbgSilentChunks = 0;
        this._dbgGaps = 0;
    }

    async _toFloat32Array(data) {
        if (data && data.data !== undefined) data = data.data;

        let buffer;
        if (data instanceof Blob) {
            buffer = await data.arrayBuffer();
        } else if (data instanceof ArrayBuffer) {
            buffer = data;
        } else if (ArrayBuffer.isView(data)) {
            buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        } else {
            throw new Error(`Unsupported audio payload type: ${typeof data}`);
        }

        if (buffer.byteLength % 4 !== 0) {
            throw new Error(`Invalid PCM float32 payload size: ${buffer.byteLength} bytes`);
        }

        return new Float32Array(buffer);
    }

    _measureSignal(floatData) {
        let peak = 0;
        let sumSq = 0;
        const n = floatData.length;
        for (let i = 0; i < n; i++) {
            const v = floatData[i];
            const a = Math.abs(v);
            if (a > peak) peak = a;
            sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, n));
        return { peak, rms };
    }

    async write(data) {
        try {
            if (this.audioContext.state === "suspended") {
                await this.audioContext.resume();
                if (this.debug) console.log("[VstWeb][audio] context resumed:", this.audioContext.state);
            }

            const audioData = await this._toFloat32Array(data);
            const frameCount = (audioData.length / this.channels) | 0;
            if (frameCount <= 0) return;

            const { peak, rms } = this._measureSignal(audioData);
            if (peak < 1e-5) this._dbgSilentChunks++;

            const audioBuffer = this.audioContext.createBuffer(
                this.channels,
                frameCount,
                this.streamSampleRate
            );

            for (let ch = 0; ch < this.channels; ch++) {
                const channelData = audioBuffer.getChannelData(ch);
                for (let i = 0; i < frameCount; i++) {
                    channelData[i] = audioData[i * this.channels + ch];
                }
            }

            const now = this.audioContext.currentTime;
            const chunkDuration = frameCount / this.streamSampleRate;

            if (this.scheduledUntil === 0) {
                this.scheduledUntil = now + this.bufferAheadTime;
            }

            if (this.scheduledUntil < now) {
                if (this.debug) {
                    console.warn(`[VstWeb][audio] gap detected! scheduledUntil=${this.scheduledUntil.toFixed(3)}, now=${now.toFixed(3)}`);
                }
                this._dbgGaps++;
                this.scheduledUntil = now + this.bufferAheadTime;
            }

            const src = this.audioContext.createBufferSource();
            src.buffer = audioBuffer;
            src.connect(this.masterGain);
            src.start(this.scheduledUntil);

            this.scheduledUntil += chunkDuration;

            if (this.debug) {
                this._dbgChunks++;
                this._dbgFrames += frameCount;
                const t = performance.now();
                if (t - this._dbgLastTs >= 1000) {
                    const latency = this.scheduledUntil - now;
                    console.log(
                        `[VstWeb][audio] chunks=${this._dbgChunks}, frames=${this._dbgFrames}, ` +
                        `peak=${peak.toExponential(2)}, rms=${rms.toExponential(2)}, ` +
                        `silentChunks=${this._dbgSilentChunks}, gaps=${this._dbgGaps}, ` +
                        `latency=${(latency * 1000).toFixed(1)}ms, ctx=${this.audioContext.state}`
                    );
                    this._dbgChunks = 0;
                    this._dbgFrames = 0;
                    this._dbgSilentChunks = 0;
                    this._dbgGaps = 0;
                    this._dbgLastTs = t;
                }
            }
        } catch (err) {
            console.error("[VstWeb][audio] write() failed:", err);
        }
    }
}

export default PlayAudioStreamable;