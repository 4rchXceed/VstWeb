import { Streamable } from "../../src/Streamable.js";
import { VstWeb } from "../../src/VstWeb.js";

class WorkerAudioStreamable extends Streamable {
    constructor() {
        super();
    }

    write(audioBuffer) {
        self.postMessage({ type: "audio", data: audioBuffer });
    }
}

class VstWebWorker {
    constructor() {
        this.vstWeb = null;
    }

    async init(vstWebConfig, v86Config, debug = true) {
        this.vstWeb = new VstWeb(this.htmlElement, vstWebConfig, debug, v86Config);
        await this.vstWeb.startVM();
    }

    async loadVst(vstArrayBuffer, pluginPath) {
        await this.vstWeb.loadVSTPlugin(vstArrayBuffer, pluginPath, WorkerAudioStreamable);
    }

    async playNote(note, velocity, duration) {
        this.vstWeb.sendNote(`${note}:1${velocity}`);
        await new Promise(resolve => setTimeout(resolve, duration));
        this.vstWeb.sendNote(`${note}:0${velocity}`);
    }

    async noteOn(note, velocity) {
        this.vstWeb.sendNote(`${note}:1${velocity}`);
    }

    async noteOff(note, velocity) {
        this.vstWeb.sendNote(`${note}:0${velocity}`);
    }

    isRunning() {
        return this.started;
    }

    isReady() {
        return this.ready;
    }

    getScreen() {
        return this.vstWeb.vm.screen_adapter.make_screenshot().src; // <img src=base64...>
    }

    async wait(delay) {
        await this.vstWeb.wait(delay);
    }
}

const vstWebWorker = new VstWebWorker();

self.onmessage = async (event) => {
    const { type, data } = event.data;
    switch (type) {
        case "init":
            await vstWebWorker.init(data.vstWebConfig, data.v86Config);
            self.postMessage({ type: "init_done" });
            break;
        case "loadVst":
            await vstWebWorker.loadVst(data.vstArrayBuffer, data.pluginPath);
            self.postMessage({ type: "loadVst_done" });
            break;
        case "playNote":
            await vstWebWorker.playNote(data.note, data.velocity, data.duration);
            self.postMessage({ type: "playNote_done" });
            break;
        case "noteOn":
            await vstWebWorker.noteOn(data.note, data.velocity);
            self.postMessage({ type: "noteOn_done" });
            break;
        case "noteOff":
            await vstWebWorker.noteOff(data.note, data.velocity);
            self.postMessage({ type: "noteOff_done" });
            break;
        case "getScreen":
            const screenData = vstWebWorker.getScreen();
            self.postMessage({ type: "getScreen_done", screenData });
            break;
        case "wait":
            await vstWebWorker.wait(data.delay);
            self.postMessage({ type: "wait_done" });
            break;
        default:
            console.warn(`Unknown message type: ${type}`);
    }
}
