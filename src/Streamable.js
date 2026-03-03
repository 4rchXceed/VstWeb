/**
 * A simple class to manage a stream of audio data. 
 */
export class Streamable {
    constructor() {
        this.buffer = new Float32Array(0);
        this.position = 0;
    }

    /**
     * Write audio data to the stream.
     * @param {ArrayBuffer} data Data under the form of an audio stream (no header, just raw audio data).
     */
    write(data) {
        throw new Error("Streamable callback not implemented, this should be overridden by the user of the Streamable class.");
    }

}