// import { Streamable } from "../../VstWeb/src/Streamable"; // TODO: Delete
import { Streamable } from "../../VstWeb/src/Streamable.js";
import { VstWeb } from "../../VstWeb/src/VstWeb.js";
import { FakeDivElement, FakeDocument } from "../Utils/FakeContainer.js";

// Got from: https://github.com/copy/v86/blob/62fd36e0bbf3da60a24be75c5245cdb11c062908/src/browser/keyboard.js#L135
// Format:
// Javascript event.keyCode -> make code
const charmap = new Uint16Array([
    0, 0, 0, 0, 0, 0, 0, 0,
    // 0x08: backspace, tab, enter
    0x0E, 0x0F, 0, 0, 0, 0x1C, 0, 0,

    // 0x10: shift, ctrl, alt, pause, caps lock
    0x2A, 0x1D, 0x38, 0, 0x3A, 0, 0, 0,

    // 0x18: escape
    0, 0, 0, 0x01, 0, 0, 0, 0,

    // 0x20: spacebar, page down/up, end, home, arrow keys, ins, del
    0x39, 0xE049, 0xE051, 0xE04F, 0xE047, 0xE04B, 0xE048, 0xE04D,
    0x50, 0, 0, 0, 0, 0x52, 0x53, 0,

    // 0x30: numbers
    0x0B, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A,

    // 0x3B: ;= (firefox only)
    0, 0x27, 0, 0x0D, 0, 0,

    // 0x40
    0,

    // 0x41: letters
    0x1E, 0x30, 0x2E, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32,
    0x31, 0x18, 0x19, 0x10, 0x13, 0x1F, 0x14, 0x16, 0x2F, 0x11, 0x2D, 0x15, 0x2C,

    // 0x5B: Left Win, Right Win, Menu
    0xE05B, 0xE05C, 0xE05D, 0, 0,

    // 0x60: keypad
    0x52, 0x4F, 0x50, 0x51, 0x4B, 0x4C, 0x4D, 0x47,
    0x48, 0x49, 0, 0, 0, 0, 0, 0,

    // 0x70: F1 to F12
    0x3B, 0x3C, 0x3D, 0x3E, 0x3F, 0x40, 0x41, 0x42, 0x43, 0x44, 0x57, 0x58,

    0, 0, 0, 0,

    // 0x80
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,

    // 0x90: Numlock
    0x45, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,

    // 0xA0: - (firefox only)
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0x0C, 0, 0,

    // 0xB0
    // ,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0x27, 0x0D, 0x33, 0x0C, 0x34, 0x35,

    // 0xC0
    // `
    0x29, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,

    // 0xD0
    // [']\
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0x1A, 0x2B, 0x1B, 0x28, 0,

    // 0xE0
    // Apple key on Gecko, Right alt
    0xE05B, 0xE038, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
]);

var codemap = {
    "Escape": 0x0001,
    "Digit1": 0x0002,
    "Digit2": 0x0003,
    "Digit3": 0x0004,
    "Digit4": 0x0005,
    "Digit5": 0x0006,
    "Digit6": 0x0007,
    "Digit7": 0x0008,
    "Digit8": 0x0009,
    "Digit9": 0x000a,
    "Digit0": 0x000b,
    "Minus": 0x000c,
    "Equal": 0x000d,
    "Backspace": 0x000e,
    "Tab": 0x000f,
    "KeyQ": 0x0010,
    "KeyW": 0x0011,
    "KeyE": 0x0012,
    "KeyR": 0x0013,
    "KeyT": 0x0014,
    "KeyY": 0x0015,
    "KeyU": 0x0016,
    "KeyI": 0x0017,
    "KeyO": 0x0018,
    "KeyP": 0x0019,
    "BracketLeft": 0x001a,
    "BracketRight": 0x001b,
    "Enter": 0x001c,
    "ControlLeft": 0x001d,
    "KeyA": 0x001e,
    "KeyS": 0x001f,
    "KeyD": 0x0020,
    "KeyF": 0x0021,
    "KeyG": 0x0022,
    "KeyH": 0x0023,
    "KeyJ": 0x0024,
    "KeyK": 0x0025,
    "KeyL": 0x0026,
    "Semicolon": 0x0027,
    "Quote": 0x0028,
    "Backquote": 0x0029,
    "ShiftLeft": 0x002a,
    "Backslash": 0x002b,
    "KeyZ": 0x002c,
    "KeyX": 0x002d,
    "KeyC": 0x002e,
    "KeyV": 0x002f,
    "KeyB": 0x0030,
    "KeyN": 0x0031,
    "KeyM": 0x0032,
    "Comma": 0x0033,
    "Period": 0x0034,
    "Slash": 0x0035,
    "IntlRo": 0x0035,
    "ShiftRight": 0x0036,
    "NumpadMultiply": 0x0037,
    "AltLeft": 0x0038,
    "Space": 0x0039,
    "CapsLock": 0x003a,
    "F1": 0x003b,
    "F2": 0x003c,
    "F3": 0x003d,
    "F4": 0x003e,
    "F5": 0x003f,
    "F6": 0x0040,
    "F7": 0x0041,
    "F8": 0x0042,
    "F9": 0x0043,
    "F10": 0x0044,
    "NumLock": 0x0045,
    "ScrollLock": 0x0046,
    "Numpad7": 0x0047,
    "Numpad8": 0x0048,
    "Numpad9": 0x0049,
    "NumpadSubtract": 0x004a,
    "Numpad4": 0x004b,
    "Numpad5": 0x004c,
    "Numpad6": 0x004d,
    "NumpadAdd": 0x004e,
    "Numpad1": 0x004f,
    "Numpad2": 0x0050,
    "Numpad3": 0x0051,
    "Numpad0": 0x0052,
    "NumpadDecimal": 0x0053,
    "IntlBackslash": 0x0056,
    "F11": 0x0057,
    "F12": 0x0058,

    "NumpadEnter": 0xe01c,
    "ControlRight": 0xe01d,
    "NumpadDivide": 0xe035,
    //"PrintScreen": 0x0063,
    "AltRight": 0xe038,
    "Home": 0xe047,
    "ArrowUp": 0xe048,
    "PageUp": 0xe049,
    "ArrowLeft": 0xe04b,
    "ArrowRight": 0xe04d,
    "End": 0xe04f,
    "ArrowDown": 0xe050,
    "PageDown": 0xe051,
    "Insert": 0xe052,
    "Delete": 0xe053,

    "MetaLeft": 0xe05b,
    "OSLeft": 0xe05b,
    "MetaRight": 0xe05c,
    "OSRight": 0xe05c,
    "ContextMenu": 0xe05d,
};

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
        this.htmlElement = new FakeDivElement(); // Fake container
        globalThis.document = new FakeDocument(new FakeDivElement()); // Needs a parent
    }

    async init(vstWebConfig, v86Config, debug = true) {
        this.vstWeb = new VstWeb(this.htmlElement, vstWebConfig, debug, v86Config);
        await this.vstWeb.startVM();
        // this.vstWeb.vm.screen_adapter.set_mode(0); // Set to text mode
    }
    translate(e) {
        if (e.code !== undefined) {
            var code = codemap[e.code];

            if (code !== undefined) {
                return code;
            }
        }

        return charmap[e.keyCode];
    }

    sendKey(key, isCtrl) {
        if (typeof key === "string") {
            this.vstWeb.vm.keyboard_adapter.bus.send("keyboard-code", this.translate({ code: key }));
        } else {
            this.vstWeb.vm.keyboard_send_text(key[0]);
        }
        if (isCtrl) {
            this.vstWeb.vm.keyboard_adapter.bus.send("keyboard-code", codemap["ControlLeft"]);
            setTimeout(() => {
                this.vstWeb.vm.keyboard_adapter.bus.send("keyboard-code", codemap["ControlLeft"] | 0x80);
            }, 100);
        }
    }

    async loadVst(vstArrayBuffer, pluginPath, saveState = false) {
        return await this.vstWeb.loadVSTPlugin(vstArrayBuffer, pluginPath, WorkerAudioStreamable, saveState);
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

    async getState() {
        return await this.vstWeb.saveState()
    }

    async loadStateFromObj(stateObj) {
        await this.vstWeb.loadStateFromObj(stateObj, WorkerAudioStreamable);
    }

    idle() {
        this.vstWeb.vm.stop(); // Pause the VM to reduce CPU usage when idle
    }

    stopIdle() {
        this.vstWeb.vm.run(); // Resume the VM when stopping idle
    }

    // getScreen() {
    //     return datas;
    // }

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
            console.log(vstWebWorker); // Expose the vstWebWorker instance for debugging
            self.postMessage({ type: "init_done" });
            break;
        case "loadVst":
            const state = await vstWebWorker.loadVst(data.vstArrayBuffer, data.pluginPath, data.saveState);
            self.postMessage({ type: "load_done", data: { state, hasState: !!state } });
            break;
        case "playNote":
            // console.log(data);

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
        case "wait":
            await vstWebWorker.wait(data.delay);
            self.postMessage({ type: "wait_done" });
            break;
        case "sendKey":
            vstWebWorker.sendKey(data.key, data.isCtrl);
            self.postMessage({ type: "sendKey_done" });
            break;
        case "idle_start":
            vstWebWorker.idle();
            self.postMessage({ type: "idle_start_done" });
            break;
        case "idle_stop":
            vstWebWorker.stopIdle();
            self.postMessage({ type: "idle_stop_done" });
            break;
        // case "getState":
        //     const state = await vstWebWorker.getState();
        //     self.postMessage({ type: "state", data: state });
        //     break;
        case "loadState":
            await vstWebWorker.loadStateFromObj(data.state);
            self.postMessage({ type: "load_done", data: { hasState: false } });
            break;
        default:
            console.warn(`Unknown message type: ${type}`);
    }
}

