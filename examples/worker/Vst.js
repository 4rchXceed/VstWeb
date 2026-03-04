import PlayAudioStreamable from "../../src/PlayAudioStreamable.js";

// This WILL be a web worker
export class VstWorker {
    VSTWEB_CONFIG_TEMPLATE = {
        state: {
            loadState: true,
            stateUrl: "../../VstWeb/states/init.bin",
        },
        syncFiles: {
            loadFiles: true,
            files: [
                "../../VstWeb/programs/remote.exe",
                "../../VstWeb/.tmp/ex"
            ]
        },
        jsZipUrl: "../../VstWeb/lib/jszip.min.js",
        keybaord_enabled: false
    }

    V86_CONFIG_TEMPLATE = {
        wasm_path: "../../VstWeb/build/v86.wasm",
        bios: {
            url: "../../VstWeb/bin/bios/seabios.bin",
        },
        vga_bios: {
            url: "../../VstWeb/bin/bios/vgabios.bin",
        },
        filesystem: {
            baseurl: "../../VstWeb/bin/arch/",
            basefs: "../../VstWeb/bin/arch.json",
        },
        net_device: {
            relay_url: "fetch",
            type: "virtio"
        },
        memory_size: 3200 * 1024 * 1024, // 3200 MB
    }

    constructor(hiddenHtmlElement, config = { vstWeb: JSON.parse(JSON.stringify(this.VSTWEB_CONFIG_TEMPLATE)), v86: JSON.parse(JSON.stringify(this.V86_CONFIG_TEMPLATE)) }) {
        this.debug = true;
        this.htmlElement = hiddenHtmlElement;
        window.global = window; // Expose the global object for VstWeb not to break
        this.vstWebConfig = config.vstWeb;
        this.worker = new Worker("./src/Audio/VstWorker.js", { type: "module" });
        this.v86Config = config.v86;
        this.started = false;
        this.ready = false;
        this.stream = new PlayAudioStreamable();
        this.screenData = null;
    }

    async init() {
        this.worker.postMessage({ type: "init", data: { vstWebConfig: this.vstWebConfig, v86Config: this.v86Config } });
        await new Promise(resolve => {
            this.worker.onmessage = (event) => {
                if (event.data.type === "init_done") {
                    window.log("VstWorker: VM is ready");
                    resolve();
                }
            };
        });
        this.started = true;
    }


    async loadVst(vstArrayBuffer, pluginPath) {
        if (!this.started) {
            console.log(false, "VstWorker: Cannot load VST plugin before starting the VM. Call init() first.");
        }
        this.worker.postMessage({ type: "loadVst", data: { vstArrayBuffer, pluginPath } });
        await new Promise(resolve => {
            this.worker.onmessage = (event) => {
                if (event.data.type === "loadVst_done") {
                    console.log("VstWorker: VST plugin loaded and ready");
                    resolve();
                }
            };
        });
        this.worker.onmessage = (event) => {
            const { type, data } = event.data;
            if (type === "getScreen") {
                this.screenData = data;
            } else if (type === "audio") {
                this.stream.write(data);
            }
        }
        this.ready = true;
    }

    async playNote(note, velocity, duration) {
        if (!this.ready) {
            console.log(false, "VstWorker: Cannot play note before loading VST plugin. Call loadVst() first.");
        }
        this.worker.postMessage({ type: "playNote", data: { note, velocity, duration } });
    }

    async noteOn(note, velocity) {
        if (!this.ready) {
            console.log(false, "VstWorker: Cannot turn note on before loading VST plugin. Call loadVst() first.");
        }
        this.worker.postMessage({ type: "noteOn", data: { note, velocity } });
    }

    async noteOff(note, velocity) {
        if (!this.ready) {
            console.log(false, "VstWorker: Cannot turn note off before loading VST plugin. Call loadVst() first.");
        }
        this.worker.postMessage({ type: "noteOff", data: { note, velocity } });

    }

    isRunning() {
        return this.started;
    }

    isReady() {
        return this.ready;
    }

    async getScreen() {
        if (!this.ready) {
            console.log(false, "VstWorker: Cannot get screen before loading VST plugin. Call loadVst() first.");
        }
        this.worker.postMessage({ type: "getScreen" });
        await new Promise(resolve => {
            const checkScreenData = () => {
                if (this.screenData) {
                    resolve();
                } else {
                    setTimeout(checkScreenData, 100);
                }
            };
            checkScreenData();
        });
        const screenData = this.screenData;
        this.screenData = null; // Clear the screen data after retrieving it to avoid returning stale data on the next call
        return screenData;
    }

    async wait(delay) {
        if (!this.ready) {
            console.log(false, "VstWorker: Cannot wait before loading VST plugin. Call loadVst() first.");
        }
        this.worker.postMessage({ type: "wait", data: { delay } });
    }
}
