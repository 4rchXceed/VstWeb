**NOW**: Update V1.2.0 - Supports state loading and saving (for waaaay faster loading time)

# VSTWeb

VSTWeb is a JavaScript library for running Windows 32 bit VST plugins in the browser using WebAssembly. (Realtime audio output)

It is built on top of v86, a x86 "emulator" (native-to-wasm jit compiler) written in rust and compiled to WebAssembly. [https://github.com/copy/v86](https://github.com/copy/v86)

**HUGE THANKS FOR THIS AMAZING PROJECT!**

## How it works

VSTWeb runs an updated Arch Linux image, with wine and a custom VST host ([link](./source_cpp/)), in v86.
The library handles the communication between the host and the browser, allowing you to load and run VST plugins in the browser.

## Features (implemented)
- Load 32 bit VST plugins in the browser
- Auto-convertor from midi to the host's custom format ([midiNote]:[OnOff][velocity], e.g. "60:1100")
- Streaming the audio output from the plugin to the browser (instead of reciving it as an ArrayBuffer), I still need to learn a little bit the v86 networking, but I'm lazy yk
- State Saving: Saving the state of the machine, and load it later. I did it because waiting 30s every time I want to test a plugin is really annoying, but now it only takes 1-2s.

## Features (planned)
- Support for multiple plugins. Right now, you can only load one plugin at a time, but I plan to add support for multiple plugins in the future.

## Features (if I have time)
- Load and save VST settings, because I won't implement a GUI, it would be really useful to be able to load and save settings from a real DAW, and then load them in the browser.

## Features (probably won't be implemented, but would be nice to have)
- Having a GUI for the plugin. This is possible, but it would be really ressource intensive, and I don't think it's worth it.

## Features that are not possible
- Load 64 bit VST plugins, because v86 only supports 32 bit
- VST3, because they only support 64 bit

## Examples
- [midi](./examples/midi.html): Load a VST plugin and a midi file, and recive the audio as a wav file.

## License
VSTWeb is licensed under the MIT License. See the [LICENSE](./LICENSE) file for more details.

## Contact
If you have any questions or suggestions, feel free to open an issue or contact me directly at [lyam.zambaz@pm.me](mailto:lyam.zambaz@pm.me)

## Pre-built images
I'm hosting these images on my personal server, so they might disappear at any time, but here are the link:
- [Shared nextcloud folder](https://webdash.dev/nextcloud/s/4kPZK45zmQ5F2wS) : Contains: the full arch installation with the required bootloader (bin.zip) + a build of v86 (v86.zip) + the state of the machine with everything installed and ready to use (state.bin)

- If I update the files, I will move the old files to a "old" folder, so you can still access them if you need to.

!!! IF THE LINKS ARE BROKEN, PLEASE CONTACT ME TO GET THE FILES BACK ONLINE !!!

## FAQ
**Q: Can I run this on mobile?**
A: I haven't tested it on mobile, but it should struggle to run

**Q: I recive a "fatal error: aeffectx.h: No such file or directory" error when trying to build source_cpp, what should I do?**
A: This is because you don't have the VST SDK. It's no longer available for download. I put an archive.org link in the source_cpp/NOTES.txt file, but if you can't access it, you can contact me and I will send you the files.

## What's next?
- Implement MULTIPLE VSTs support
- Better stability and performance improvements
