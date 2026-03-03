import { midiToNotesTxt } from "../src/MidiToNotesTxt.js";
import PlayAudioStreamable from "../src/PlayAudioStreamable.js";
import { VstWeb } from "../src/VstWeb.js";
// Source - https://stackoverflow.com/a/65953657
// Posted by Kuba
// Retrieved 2026-03-01, License - CC BY-SA 4.0

window.global = window;

const vmContainer = document.getElementById("preview");
const vstWeb = new VstWeb(vmContainer, {
    state: {
        loadState: true,
        stateUrl: "../states/init.bin",
    },
    syncFiles: {
        loadFiles: true,
        files: [
            "../programs/remote.exe",
            "../.tmp/ex"
        ]
    },
    keybaord_enabled: false
},
    true,
    {
        wasm_path: "../build/v86.wasm",
        bios: {
            url: "../bin/bios/seabios.bin",
        },
        vga_bios: {
            url: "../bin/bios/vgabios.bin",
        },
        filesystem: {
            baseurl: "../bin/arch/",
            basefs: "../bin/arch.json",
        },
        net_device: {
            relay_url: "fetch",
            type: "virtio"
        },
    });
window.vstWeb = vstWeb; // For debugging
const vstFileInput = document.getElementById("loadVst");
const midiFileInput = document.getElementById("loadMidi");
const vstFileName = document.getElementById("vstPath");
let isLoading = false;
document.getElementById("process").addEventListener("click", async () => {
    if (isLoading) {
        alert("Already processing, please reload.");
        return;
    }
    if (midiFileInput.files[0]) {
        isLoading = true;
        const midiArrayBuffer = await midiFileInput.files[0].arrayBuffer();
        const notesTxt = midiToNotesTxt(midiArrayBuffer);
        const vstArrayBuffer = await vstFileInput.files[0].arrayBuffer();
        await vstWeb.loadVSTPlugin(vstArrayBuffer, vstFileName.value, PlayAudioStreamable); // Use the prebuilt PlayAudioStreamable class to play the audio output of the plugin in real time.
        for (const line of notesTxt.split("\n")) {
            let parts = line.split(":");
            if (parts[0] === "!") {
                await new Promise(resolve => setTimeout(resolve, parseInt(parts[1]) / 2));
            }
            else {
                vstWeb.sendNote(line);
            }
        }
    } else {
        alert("Please load a MIDI file first.");
    }
});
vstWeb.startVM();
