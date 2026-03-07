import { MIDIFile } from '../lib/MIDIFile.js';

/**
 * @deprecated Plz don't use this anymore, it's really buggy and it sucks
 * Convert a MID file (as ArrayBuffer) to a text format for VstWeb !! THE TIMING IS OFF, I HAVE NO IDEA WHY, BUT IT'S ALWAYS TOO FAST, SO I MULTIPLY IT BY 2, IF YOU KNOW WHY PLEASE TELL ME
 * @param {ArrayBuffer} midiArrayBuffer 
 * @returns {string} The notes text
 */
export function midiToNotesTxt(midiArrayBuffer) {
    const midi = new MIDIFile(midiArrayBuffer);
    let tempo = 500000;
    let total = "";
    let totalTime = 0;

    const events = midi.getMidiEvents();

    if (events.length > 0) {
        for (const event of events) {
            if (event.type === 255 && event.metaType === 81) {
                tempo = event.data;
            }

            if (event.delta !== 0) {
                const quarterNotes = event.delta / midi.header.getTicksPerBeat();
                const seconds = ((quarterNotes * tempo) / 1000000) * 2; // I have no idea but it's always too fast
                total += `!:${Math.round(seconds * 1000)}\n`; // In milliseconds
                totalTime += seconds * 1000;
            }
            if (event.subtype === 8 || event.subtype === 9) {
                const note = event.param1.toString();
                if (event.subtype === 9) {
                    total += `${note}:1100\n`;
                } else if (event.subtype === 8) {
                    total += `${note}:0000\n`;
                }
            }
        }
    }
    return total;
}