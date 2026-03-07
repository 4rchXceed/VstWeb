import { V86 } from "../build/libv86.mjs";
import PlayAudioStreamable from "./PlayAudioStreamable.js";
import { Streamable } from "./Streamable.js";

export class VstWeb {
    VM_STATIC_ADRESS = "192.168.86.100"
    VM_PORT_AUDIO_RECIVE = 12345
    VM_PORT_NOTE_SEND = 12346
    deps = [
        "jszip.min.js",
    ];
    TIME_SYNC_COMMAND = "hwclock -s\n";
    VST_SCRIPT = "hwclock -s && modprobe virtio_net && dhcpcd -w4 enp0s10 && ip link set dev enp0s10 down && ip link set dev enp0s10 address ::MAC_ADDR:: && ip link set dev enp0s10 up && clear && boxedwine/opt/wine/bin/wine ./remote.exe \"::PLUGIN_PATH::\" &";
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
        ].join(" "),
        net_device: {
            relay_url: "fetch",
            type: "virtio"
        },
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
        jsZipUrl: "./jszip.min.js", // ONLY used in a web worker context
        keybaord_enabled: false,
    }, loggingEnabled = true, vmSettingsOverrides = {}
    ) {
        this.loggingEnabled = loggingEnabled;
        this.vm = null;
        this.vmContainer = vmContainer;
        this.appSettings = appSettings;
        this.isWaiting = false;
        this.vm_settings = JSON.parse(JSON.stringify(this.DEFAULT_VM_SETTINGS)); // Deep copy
        this.isAudioStreamConnected = false;
        this.audioStream = null;
        this.noteSendConnection = null;
        for (const [key, value] of Object.entries(vmSettingsOverrides)) {
            this.vm_settings[key] = value;
        }
        if (!globalThis.window) { // Web worker
            (async () => {
                globalThis.importScripts = function (url) { };
                await import(appSettings.jsZipUrl);
                // console.log(globalThis.JSZip);
                globalThis.window = {
                    addEventListener: () => { },
                    removeEventListener: () => { },
                }
            })();
        } else {
            if (!window.JSZip) {
                this.log("JSZip not found!");
            }
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
     * !!! THIS NEEDS TO BE CALLED FROM AN ASYNC FUNCTION, OTHERWISE THE XMLHttpRequest WON'T WORK (see https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest_API/Synchronous_and_Asynchronous_Requests) !!!
     * RUNNING THE VM IN A WEB WORKER IS RECOMMENDED
     * Load the state of the VM from a given URL. The state should be a binary file that can be loaded by the VM. You can use https://copy.sh/v86/ to create a state file from a running VM. (it needs to be the exact VM image that you're using in VstWeb, otherwise it will not work).
     * I advise you to get the "official" VstWeb image from README, and use the official state file (I spent a lot of time creating this image, it's very tricky to get everything working)
     * @param {string} stateUrl 
     */
    async loadState(stateUrl) {
        const xmlHttp = new XMLHttpRequest();
        xmlHttp.responseType = "arraybuffer";
        let stateLoaded = false;
        xmlHttp.onload = function () {
            if (xmlHttp.status === 200) {
                stateLoaded = true;
            } else {
                console.error(`Failed to load state: ${xmlHttp.status} ${xmlHttp.statusText}`);
            }
        }
        xmlHttp.onerror = function () {
            throw new Error(`Failed to fetch state: ${response.status} ${response.statusText}`);
        }
        xmlHttp.open("GET", stateUrl, window.location ? true : false); // If we're in a web worker, we need to make a synchronous request, otherwise the onload event won't work. WINDOW is defined in the worker sometimes (fake window object)
        xmlHttp.send(null);

        await new Promise((resolve) => {
            const checkStateLoaded = () => {
                if (stateLoaded) {
                    resolve();
                } else {
                    setTimeout(checkStateLoaded, 100);
                }
            }
            checkStateLoaded();
        });

        // const response = await fetch(stateUrl);

        // if (!response.ok) {

        // }


        this.vm.restore_state(xmlHttp.response);
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

    // TODO: Handle the case where the port is closed and retry
    /**
     * Connect to the VST host
     * @param {Streamable} streamable 
     * @returns 
     */
    async startNetworking(streamable = PlayAudioStreamable) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait a little bit
        (async () => {
            if (!this.isAudioStreamConnected) {
                // let open = await this.vm.network_adapter.tcp_probe(this.VM_PORT_AUDIO_RECIVE);
                // if (open) {
                const audioStream = new streamable();
                this.audioStream = null;
                while (!this.audioStream || this.audioStream.state !== "established") {
                    this.audioStream = await this.vm.network_adapter.connect(this.VM_PORT_AUDIO_RECIVE);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                this.log(`Port ${this.VM_PORT_AUDIO_RECIVE} is open, starting audio stream...`);
                this.isAudioStreamConnected = true;

                // Events are broken
                // connection.on("connect", () => {
                //     this.log("Audio stream connected!");
                //     this.isAudioStreamConnected = true;
                // });
                this.audioStream.on("data", async (data) => {
                    await audioStream.write(data);
                    setTimeout(() => {
                        this.audioStream.write(new TextEncoder().encode("OK\n")); // Send an OK back to the VM
                    }, 10);
                });
                // this.audioStream.on("close", () => {
                //     this.log("Audio stream closed!");
                //     this.isAudioStreamConnected = false;
                // });
                // this.audioStream.on("shutdown", () => {
                //     this.log("Audio stream shutdown!");
                //     this.isAudioStreamConnected = false;
                // });
                // }
            } else {
                this.log("Audio stream is already connected!");
            }
        })();
        while (!this.vm.fs9p.SearchPath("/root/.finished_start").id === -1) { // Wait for the file .finished_start to be created in the VM filesystem
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (this.noteSendConnection === null) {
            // let noteSendOpen = await this.vm.network_adapter.tcp_probe(this.VM_PORT_NOTE_SEND);
            // if (noteSendOpen) {

            while (this.noteSendConnection === null || (this.noteSendConnection && this.noteSendConnection.state !== "established")) {
                this.noteSendConnection = await this.vm.network_adapter.connect(this.VM_PORT_NOTE_SEND);
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            this.log(`Port ${this.VM_PORT_NOTE_SEND} is open, starting note send stream...`);
            this.noteSendConnection.on("data", async (data) => {
                if (new TextDecoder().decode(data).trim() === "OK") {
                    this.isWaiting = false;
                }
            });

            // Idk why but the event listeners for this connection don't work
            // this.noteSendConnection.on("connect", () => {
            //     this.log("Note send stream connected!");
            //     this.noteSendConnection = this.noteSendConnection;
            // });
            // this.noteSendConnection.on("close", () => {
            //     this.log("Note send stream closed!");
            //     this.noteSendConnection = null;
            // });
            // this.noteSendConnection.on("shutdown", () => {
            //     this.log("Note send stream shutdown!");
            //     this.noteSendConnection = null;
            // });
            // }
        } else {
            this.log("Note send stream is already connected!");
        }
        return new Promise((resolve) => {
            const checkConnections = () => {
                if (this.isAudioStreamConnected && this.noteSendConnection !== null) {
                    resolve();
                } else {
                    setTimeout(checkConnections, 100);
                }
            };
            checkConnections();
        });
    }

    /**
     * Send a note to the VST
     * @param {string} noteTxt Note to the format: ([midiNote]:[OnOff][velocity], e.g. "60:1100")
     * @returns 
     */
    sendNote(noteTxt) {
        this.log(`Sending note: ${noteTxt}`);
        if (this.noteSendConnection === null) {
            this.log("Note send connection is not established, can't send note!");
            return false;
        } else {
            this.noteSendConnection.write(new TextEncoder().encode(noteTxt + "\n")); // Add a newline at the end of the note
            return true;
        }
    }

    /**
     * Save the state of the VM. This will return an object containing the state of the VM and the connections (audio stream and note send connection). You can use this object to restore the state of the VM later using the loadStateFromObj() method.
     * @returns {Promise<object>} The object containing the state (obj.state) and the connections (this.audioStream + this.noteSendConnection)
     */
    async saveState() {
        const state = await this.vm.save_state();
        const finalObj = {
            state: state,
            mac: this.format_mac(this.vm.network_adapter.vm_mac),
        }
        return finalObj;
    }

    /**
     * Load the state of the VM from an object. This is the object returned by the saveState() method. This will restore the state of the VM and the connections (audio stream and note send connection).
     * @param {object} stateObj The object containing the state (obj.state) and the connections (obj.connections) to restore. This should be the object returned by the saveState() method.
     * @param {class} streamable A class that extends the Streamable class, used to stream the audio data from the VM to the browser. By default, it uses the PlayAudioStreamable class, which plays the audio directly in the browser. See the Streamable class for more details
     */
    async loadStateFromObj(stateObj, streamable = PlayAudioStreamable) {
        await this.vm.restore_state(stateObj.state);

        this.vm.v86.cpu.devices.virtio_net.bus.send("net0-mac", stateObj.mac); // Set the MAC address to the one in the state object, otherwise the networking won't work, because all vm-out requests are blocked until the MAC address is the same as the one in the state
        this.vm.keyboard_send_text(this.TIME_SYNC_COMMAND); // Sync the time, otherwise the Sleep function function in the plugin... straight up doesn't work
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait a little bit for the time sync to take effect
        await this.startNetworking(streamable);
    }

    /**
     * Load a VST plugin into the VM. This will extract the plugin files from a ZIP archive and place them in the VM's filesystem.
     * This will take a while (on my PC: 30s)
     * @param {ArrayBuffer} archive A ZIP archive containing the VST plugin files. 
     * @param {string} pluginPath The path to the plugin's .dll file inside the archive (e.g. "MyPlugin/MyPlugin.dll").
     * @param {class} streamable A class that extends the Streamable class, used to stream the audio data from the VM to the browser. By default, it uses the PlayAudioStreamable class, which plays the audio directly in the browser. See the Streamable class for more details
     * @param {boolean} saveState Whether to save the state after loading the plugin (THIS WILL *NOT* CALL Networking, SO you'll need to **MANUALLY** call loadState for it to work)
     * @returns {Promise<object|void>} If saveState is true, it will return the state object that can be used to restore the state later. Otherwise, it will return void.
     */
    async loadVSTPlugin(archive, pluginPath, streamable = PlayAudioStreamable, saveState = false) {
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

        const command = this.VST_SCRIPT.replace("::PLUGIN_PATH::", `./vsts/${pluginPath}`).replace("::MAC_ADDR::", this.format_mac(this.vm.network_adapter.vm_mac));
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
        if (saveState) {
            return await this.saveState(); // Return the state
        }
        await this.startNetworking(streamable);
        this.log("Plugin loaded successfully!");
        return;
    }

    async wait(delay) {
        if (this.isWaiting) {
            this.log("Already waiting, skipping wait call");
            return;
        }
        if (!this.noteSendConnection) {
            this.log("Error: Note send connection not found!");
            return;
        }
        this.isWaiting = true;
        this.noteSendConnection.write(new TextEncoder().encode(`!:${delay}\n`)); // !:1000 = wait for 1000ms
        // const startTime = performance.now();
        while (this.isWaiting) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    /**
     * @deprecated Not used anymore
     * Convert a Float32Array of audio data to a WAV buffer.
     * @param {Float32Array} audioData The audio data to convert to a WAV buffer. The audio data is generated by the /source_cpp (in the repository)
     * @returns {Promise<ArrayBuffer>} The WAV buffer
     */
    async bufferToWavBuffer(audioData) {
        const channels = this.REMOTE_SCRIPT_AUDIO_SETTINGS.channels;
        const sampleRate = this.REMOTE_SCRIPT_AUDIO_SETTINGS.sampleRate;
        const wavData = this.encodeWav(audioData, channels, sampleRate);
        return wavData;
    }
    // https://github.com/copy/v86/blob/master/src/ne2k.js#L236
    /**
     * Format a MAC address from an array of 6 bytes to a string format (e.g. "00:11:22:33:44:55").
     * @param {string[]} mac Array of 6 bytes representing the MAC address (e.g. [0, 17, 34, 51, 68, 85])
     * @returns {string} The formatted MAC address (e.g. "00:11:22:33:44:55")
     */
    format_mac(mac) {
        return [
            mac[0].toString(16).padStart(2, "0"),
            mac[1].toString(16).padStart(2, "0"),
            mac[2].toString(16).padStart(2, "0"),
            mac[3].toString(16).padStart(2, "0"),
            mac[4].toString(16).padStart(2, "0"),
            mac[5].toString(16).padStart(2, "0"),
        ].join(":");
    }

    // Found idk where
    /**
     * @deprecated Not used anymore
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
        * @deprecated THIS FUNCTION WON'T WORK ANYMORE, BECAUSE OF THE UPDATED SOURCE_CPP CODE. USE THE Streamable CLASS INSTEAD (when calling loadVstPlugin())
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
