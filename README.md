# VSTWeb

VSTWeb is a JavaScript library for running Windows 32 bit VST plugins in the browser using WebAssembly.
It is built on top of v86, a x86 "emulator" (native-to-wasm jit compiler) written in rust and compiled to WebAssembly. [https://github.com/copy/v86](https://github.com/copy/v86)

**HUGE THANKS FOR THIS AMAZING PROJECT!**

## How it works

VSTWeb runs an updated Arch Linux image, with wine and a custom VST host ([link](./source_cpp/)), in v86.
The library handles the communication between the host and the browser, allowing you to load and run VST plugins in the browser.

## Features (implemented)
- Load 32 bit VST plugins in the browser
- Run the plugin from a text file (view specification down below)
- Recive the audio output from the plugin as an ArrayBuffer
- Auto-convertor from midi to the text file (I call it "NotesTxt/notes.txt")

## Features (if I have time)
- Load and save VST settings, because I won't implement a GUI, it would be really useful to be able to load and save settings from a real DAW, and then load them in the browser.

## Features (probably won't be implemented, but would be nice to have)
- Streaming the audio output from the plugin to the browser (instead of reciving it as an ArrayBuffer), I still need to learn a little bit the v86 networking, but I'm lazy yk
- Having a GUI for the plugin. This is possible, but it would be really ressource intensive, and I don't think it's worth it.

## Features that are not possible
- Load 64 bit VST plugins, because v86 only supports 32 bit
- VST3, because they only support 64 bit

## Examples
- [midi](./examples/midi.html): Load a VST plugin and a midi file, and recive the audio as a wav file.

## Specification for the text file
The text file should be in the following format:
```
!:[time-to-wait-ms] <- wait for the specified time before executing the next command
[midi-note-number]:1[velocity] <- turn "on" the note
[midi-note-number]:0000 <- turn "off" the note (velocity is ignored)
```
For example:
```
!:1000
60:127
!:500
60:0000
```

## License
VSTWeb is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more details.

## Contact
If you have any questions or suggestions, feel free to open an issue or contact me directly at [lyam.zambaz@pm.me](mailto:lyam.zambaz@pm.me)

## Pre-built images
I'm hosting these images on my personal server, so they might disappear at any time, but here are the link:
- [Shared nextcloud folder](https://webdash.dev/nextcloud/s/4kPZK45zmQ5F2wS) : Contains: the full arch installation with the required bootloader (bin.zip) + a build of v86 (v86.zip) + the state of the machine with everything installed and ready to use (state.bin)

!!! IF THE LINKS ARE BROKEN, PLEASE CONTACT ME TO GET THE FILES BACK ONLINE !!!