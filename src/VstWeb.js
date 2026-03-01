import { dirname } from "./Utils.js";
import { V86 } from "../build/libv86.mjs";

export class VstWeb {
    deps = [
        "jszip.min.js",
    ];
    VST_SCRIPT = "clear && boxedwine/opt/wine/bin/wine ./remote.exe \"::PLUGIN_PATH::\"";
    SYNC_FILES = [
        "programs/remote.exe"
    ];
    REMOTE_SCRIPT_AUDIO_SETTINGS = {
        sampleRate: 44100,
        channels: 2,
    }
    DEFAULT_VM_SETTINGS = {
        screen_container: null,
        bios: {
            url: "bin/bios/seabios.bin",
        },
        vga_bios: {
            url: "bin/bios/vgabios.bin",
        },
        filesystem: {
            baseurl: "bin/arch/",
            basefs: "bin/arch.json",
        },
        autostart: true,
        memory_size: 3200 * 1024 * 1024,
        vga_memory_size: 16 * 1024 * 1024,
        bzimage_initrd_from_filesystem: true,
        cmdline: [
            "rw",
            "root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose",
            "init=/sbin/init",
        ].join(" ")
    };

    /**
     * Log a message to the console if logging is enabled (set loggingEnabled to true in the constructor)
     * @param  {...any} args Message to log, will be prefixed with [VstWeb] for easier debugging
     */
    log(...args) {
        if (this.loggingEnabled) {
            console.log("[VstWeb]", ...args);
        }
    }

    /**
     * VstWeb is a library for loading and runnig *32-bit* *VST2* plugins in the browser using a virtual machine. It uses a custom Linux image with Wine and a custom VST host to run the plugins.
     * It communicates with the plugins using a simple text file and a binary pipe file (not very efficient, but the networking in v86 sucks)
     * It requires the bios files and the Linux image files to be hosted somewhere, you can use the ones I provide in the bin folder, or you can build your own using the instructions in the README.
     * @param {boolean} loggingEnabled 
     * @param {object} vmSettingsOverrides 
     */
    constructor(vmContainer, appSettings = {
        state: {
            loadState: true,
            stateUrl: "states/init.bin",
        },
        syncFiles: {
            loadFiles: true,
            files: [...this.SYNC_FILES],
        },
        keybaord_enabled: false,
    }, loggingEnabled = true, vmSettingsOverrides = {}
    ) {
        this.loggingEnabled = loggingEnabled;
        this.vm = null;
        this.vmContainer = vmContainer;
        this.appSettings = appSettings;
        this.vm_settings = JSON.parse(JSON.stringify(this.DEFAULT_VM_SETTINGS)); // Deep copy
        for (const [key, value] of Object.entries(vmSettingsOverrides)) {
            this.vm_settings[key] = value;
        }
        if (!window.JSZip) {
            this.log("JSZip not found!");
        }
    }

    /**
     * Performs a bunch of checks to make sure the VM settings are correct. It doesn't throw any error. It just logs warnings to the console if something seems off
     * @param {object} settings 
     */
    vmChecks(settings) {
        if (!settings.screen_container) {
            this.log("IMPORTANT WARNING: No screen container provided in VM settings!");
        }
        if (!settings.bios || !settings.bios.url) {
            this.log("IMPORTANT WARNING: No BIOS URL provided in VM settings!");
        }
        if (!settings.vga_bios || !settings.vga_bios.url) {
            this.log("IMPORTANT WARNING: No VGA BIOS URL provided in VM settings!");
        }
        if (!settings.filesystem || !settings.filesystem.baseurl || !settings.filesystem.basefs) {
            this.log("IMPORTANT WARNING: No filesystem configuration provided in VM settings!");
        }
        if (!settings.cmdline) {
            this.log("IMPORTANT WARNING: No cmdline provided in VM settings!");
        }
        if (!settings.memory_size) {
            this.log("IMPORTANT WARNING: No memory size provided in VM settings!");
        }
        if (settings.memory_size < 128 * 1024 * 1024) {
            this.log("IMPORTANT WARNING: Memory size is very low, performance may be poor!");
        }
        if (!settings.autostart) {
            this.log("IMPORTANT WARNING: VM is not set to autostart, you will need to start it manually!");
        }
        if (!settings.bzimage_initrd_from_filesystem || settings.bzimage_initrd_from_filesystem === false) {
            this.log("IMPORTANT WARNING: bzimage_initrd_from_filesystem is disabled (idk what it does, but it f things up)!");
        }
        this.log("VM settings checks completed.");
    }

    /**
     * Load the state of the VM from a given URL. The state should be a binary file that can be loaded by the VM. You can use https://copy.sh/v86/ to create a state file from a running VM. (it needs to be the exact VM image that you're using in VstWeb, otherwise it will not work).
     * I advise you to get the "official" VstWeb image from README, and use the official state file (I spent a lot of time creating this image, it's very tricky to get everything working)
     * @param {string} stateUrl 
     */
    async loadState(stateUrl) {
        const response = await fetch(stateUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch state: ${response.status} ${response.statusText}`);
        }
        const state = await response.arrayBuffer();
        this.vm.restore_state(state);
        if (this.appSettings.syncFiles.loadFiles) {
            await this.loadFiles(this.appSettings.syncFiles.files);
        }
    }

    /**
     * Load files into the VM filesystem. The files should be an array of URLs that can be fetched.
     * @param {string[]} files 
     */
    async loadFiles(files) {
        for (const file of files) {
            const response = await fetch(file);
            if (!response.ok) {
                this.log(`Failed to fetch file ${file}: ${response.status} ${response.statusText}`);
                continue;
            }
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const filename = file.split("/").pop();
            await this.vm.create_file(`/root/${filename}`, uint8Array);
        }
    }

    /**
     * Start the VM. This will initialize the VM and start it. (Warning: this will eat alot of RAM, the CPU should be ok IF YOU ARE LOADING A STATE)
     * @returns {Promise} Resolves when the VM is ready. (if loadState is enabled, it will also wait for the state to be loaded)
     */
    async startVM() {
        const settings = JSON.parse(JSON.stringify(this.vm_settings)); // Deep copy
        settings.screen_container = this.vmContainer;
        this.vmChecks(settings);
        this.vm = new V86(settings);
        if (this.appSettings.state.loadState) {
            const self = this;
            return new Promise((resolve) => {
                this.vm.add_listener("emulator-ready", async function () {
                    await self.loadState(self.appSettings.state.stateUrl);

                    if (!self.appSettings.keyboard_adapter) {
                        self.vm.keyboard_adapter.destroy();
                    }
                    resolve();
                });
            });
        } else {
            this.log("WARNING: State loading is disabled, you probably don't want this! (Once loaded, call loadFiles() if you want to load the sync files)");
            return new Promise((resolve) => {
                this.vm.add_listener("emulator-ready", function () {
                    if (!self.appSettings.keyboard_adapter) {
                        self.vm.keyboard_adapter.destroy();
                    }
                    resolve();
                });
            });
        }
    }

    /**
     * Load a VST plugin into the VM. This will extract the plugin files from a ZIP archive and place them in the VM's filesystem.
     * This will take a while (on my PC: 30s)
     * @param {ArrayBuffer} archive A ZIP archive containing the VST plugin files. 
     * @param {string} pluginPath The path to the plugin's .dll file inside the archive (e.g. "MyPlugin/MyPlugin.dll").
     * @returns 
     */
    async loadVSTPlugin(archive, pluginPath) {
        const zip = await JSZip.loadAsync(archive);
        if (this.vm.fs9p.SearchPath("/root/vsts").id === -1) {
            this.log("Creating /root/vsts directory in vm filesystem");
            await this.vm.fs9p.CreateDirectory("vsts", this.vm.fs9p.SearchPath("/root").id);
        }
        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
            if (!zipEntry.dir) {
                const fileData = await zipEntry.async("uint8array");
                this.log(`Creating file /root/vsts/${relativePath} in vm filesystem`);
                const parent = relativePath.split("/").slice(0, -1).join("/");
                if (parent) {
                    this.log(`Creating directory /root/vsts/${parent} in vm filesystem`);
                    let currentPath = "/root/vsts";
                    for (const part of parent.split("/")) {
                        currentPath += "/" + part;
                        if (this.vm.fs9p.SearchPath(currentPath).id === -1) {
                            this.log(`Creating directory ${currentPath} in vm filesystem`);
                            await this.vm.fs9p.CreateDirectory(part, this.vm.fs9p.SearchPath(currentPath.split("/").slice(0, -1).join("/")).id);
                        }
                    }
                }
                if (this.vm.fs9p.SearchPath(`/root/vsts/${relativePath}`).id !== -1) {
                    this.log(`File /root/vsts/${relativePath} already exists, skipping.`);
                } else {
                    await this.vm.create_file(`/root/vsts/${relativePath}`, fileData);
                }
            }
        }
        const command = this.VST_SCRIPT.replace("::PLUGIN_PATH::", `./vsts/${pluginPath}`);
        this.log(`Executing command in VM: ${command}`);
        this.vm.keyboard_send_text(command + "\n");
        let isProcessed = false;
        while (!isProcessed) {
            if (this.vm.fs9p.SearchPath("/root/.started").id !== -1) {
                isProcessed = true;
            } else {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        this.log("Plugin loaded successfully!");
        return;
    }

    /**
     * Convert a Float32Array of audio data to a WAV buffer.
     * @param {Float32Array} audioData The audio data to convert to a WAV buffer. The audio data is generated by the /source_cpp (in the repository)
     * @returns {ArrayBuffer} The WAV buffer
     */
    async bufferToWavBuffer(audioData) {
        const channels = this.REMOTE_SCRIPT_AUDIO_SETTINGS.channels;
        const sampleRate = this.REMOTE_SCRIPT_AUDIO_SETTINGS.sampleRate;
        const wavData = this.encodeWav(audioData, channels, sampleRate);
        return wavData;
    }

    // Found idk where
    /**
     * Can't say much about this, except that it's the function to go from raw audio samples to a WAV file.
     */
    encodeWav(samples, channels, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        const subChunk2Size = samples.length * 2;
        const chunkSize = 36 + subChunk2Size;

        writeString(0, "RIFF");
        view.setUint32(4, chunkSize, true);
        writeString(8, "WAVE");
        writeString(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channels * 2, true);
        view.setUint16(32, channels * 2, true);
        view.setUint16(34, 16, true);
        writeString(36, "data");
        view.setUint32(40, subChunk2Size, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            view.setInt16(offset, samples[i] < 0 ? samples[i] * 0x8000 : samples[i] * 0x7FFF, true);
            offset += 2;
        }

        return buffer;
    }

    /**
     * Process the notes text generated by MidiToNotesTxt.js (or in the format of the notes.txt file in the repository)
     * @param {string} notesTxt The notes text to process (can be generated with MidiToNotesTxt.js)
     * @returns {Promise<ArrayBuffer>} The WAV buffer generated by the plugin in the VM.
     */
    async processNotes(notesTxt) {
        const rootId = this.vm.fs9p.SearchPath("/root").id;
        if (rootId === -1) {
            this.log("Error: /root directory not found in VM filesystem!");
            return;
        }
        this.vm.fs9p.unlink_from_dir(rootId, "pipe.bin"); // Make sure to remove the old pipe if it exists, otherwise it will cause issues with the plugin. Doesn't return an error if the file already exists
        const encoder = new TextEncoder();
        const notesData = encoder.encode(notesTxt);
        await this.vm.create_file("/root/notes.txt", notesData);
        let pipeBinFound = false;
        let pipeBinContent = null;
        while (!pipeBinFound) {
            if (this.vm.fs9p.SearchPath("/root/pipe.bin").id !== -1) {
                pipeBinFound = true;
                pipeBinContent = await this.vm.read_file("/root/pipe.bin");
            } else {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        const audioData = new Float32Array(
            new ArrayBuffer(pipeBinContent.length),
            0,
            pipeBinContent.length / 4
        );
        audioData.set(new Float32Array(pipeBinContent.buffer, pipeBinContent.byteOffset, pipeBinContent.length / 4));
        const wavBuffer = await this.bufferToWavBuffer(audioData);
        return wavBuffer;
    }
}
