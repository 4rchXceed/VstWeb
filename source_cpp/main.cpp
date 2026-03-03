// Win32 : Minimal VST 2.x Synth host in C++11.
//
// This is a simplified version of the following project by hotwatermorning :
//      A sample VST Host Application for C++ Advent Calendar 2013 5th day.
//      https://github.com/hotwatermorning/VstHostDemo
//
// Usage :
//      1. Compile & Run this program.
//      2. Select your VST Synth DLL.
//      3. Press QWERTY, ZXCV, etc.
//      4. Press Ctrl-C to exit.
//
// See also :
//      Steinberg Media Technologies - The Yvan Grabit Developer Resource
//      http://ygrabit.steinberg.de/~ygrabit/public_html/index.html
//
//      MrsWatson - a command-line audio plugin host.
//      https://github.com/teragonaudio/MrsWatson
//
//  Notes :
//      "vst2.x/aeffectx.h" is part of VST3 SDK. You can download VST3 SDK from
//      Steinberg SDK Download Portal : http://www.steinberg.net/nc/en/company/developers/sdk_download_portal.html
#define UNICODE
#include <process.h>
#include <mmdeviceapi.h>
#include <winsock2.h>

#define UNICODE

#include <algorithm>
#include <atomic>
#include <iostream>
#include <map>
#include <fstream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <functional>

#pragma warning(push)
#pragma warning(disable : 4996)
#include "aeffectx.h"
#pragma warning(pop)

bool isProcessing = false;

#define STATIC_ADRESS "192.168.86.100"
#define PORT_AUDIO_SEND 12345
#define PORT_NOTE_RECEIVE 12346

#define ASSERT_THROW(c, e)           \
    if (!(c))                        \
    {                                \
        throw std::runtime_error(e); \
    }
#define CLOSE_HANDLE(x) \
    if ((x))            \
    {                   \
        CloseHandle(x); \
        x = nullptr;    \
    }
#define RELEASE(x)      \
    if ((x))            \
    {                   \
        (x)->Release(); \
        x = nullptr;    \
    }

struct ComInit
{
    ComInit() { CoInitializeEx(nullptr, COINIT_MULTITHREADED); }
    ~ComInit() { CoUninitialize(); }
};

class VstPlugin
{
public:
    VstPlugin(const char *vstModulePath)
    {
        init(vstModulePath);
    }

    ~VstPlugin()
    {
        cleanup();
    }

    size_t getSamplePos() const { return samplePos; }
    size_t getSampleRate() const { return 44100; }
    size_t getBlockSize() const { return 1024; }
    size_t getChannelCount() const { return 2; }
    static const char *getVendorString() { return "TEST_VENDOR"; }
    static const char *getProductString() { return "TEST_PRODUCT"; }
    static int getVendorVersion() { return 1; }
    static const char **getCapabilities()
    {
        static const char *hostCapabilities[] = {
            "sendVstEvents",
            "sendVstMidiEvents",
            "sizeWindow",
            "startStopProcess",
            "sendVstMidiEventFlagIsRealtime",
            nullptr};
        return hostCapabilities;
    }

    bool getFlags(int32_t m) const { return (aEffect->flags & m) == m; }
    bool flagsHasEditor() const { return getFlags(effFlagsHasEditor); }
    bool flagsIsSynth() const { return getFlags(effFlagsIsSynth); }
    intptr_t dispatcher(int32_t opcode, int32_t index = 0, intptr_t value = 0, void *ptr = nullptr, float opt = 0.0f) const
    {
        return aEffect->dispatcher(aEffect, opcode, index, value, ptr, opt);
    }

    void resizeEditor(const RECT &clientRc) const
    {
        if (editorHwnd)
        {
            auto rc = clientRc;
            const auto style = GetWindowLongPtr(editorHwnd, GWL_STYLE);
            const auto exStyle = GetWindowLongPtr(editorHwnd, GWL_EXSTYLE);
            const BOOL fMenu = GetMenu(editorHwnd) != nullptr;
            AdjustWindowRectEx(&rc, style, fMenu, exStyle);
            MoveWindow(editorHwnd, 0, 0, rc.right - rc.left, rc.bottom - rc.top, TRUE);
        }
    }

    void sendMidiNote(int midiChannel, int noteNumber, bool onOff, int velocity)
    {
        VstMidiEvent e{};
        e.type = kVstMidiType;
        e.byteSize = sizeof(e);
        e.flags = kVstMidiEventIsRealtime;
        e.midiData[0] = static_cast<char>(midiChannel + (onOff ? 0x90 : 0x80));
        e.midiData[1] = static_cast<char>(noteNumber);
        e.midiData[2] = static_cast<char>(velocity);
        if (auto l = vstMidi.lock())
        {
            vstMidi.events.push_back(e);
        }
    }

    // This function is called from refillCallback() which is running in audio thread.
    void processEvents()
    {
        vstMidiEvents.clear();
        if (auto l = vstMidi.lock())
        {
            std::swap(vstMidiEvents, vstMidi.events);
        }
        if (!vstMidiEvents.empty())
        {
            const auto n = vstMidiEvents.size();
            const auto bytes = sizeof(VstEvents) + sizeof(VstEvent *) * n;
            vstEventBuffer.resize(bytes);
            auto *ve = reinterpret_cast<VstEvents *>(vstEventBuffer.data());
            ve->numEvents = n;
            ve->reserved = 0;
            for (size_t i = 0; i < n; ++i)
            {
                ve->events[i] = reinterpret_cast<VstEvent *>(&vstMidiEvents[i]);
            }
            dispatcher(effProcessEvents, 0, 0, ve);
        }
    }

    // This function is called from refillCallback() which is running in audio thread.
    float **processAudio(size_t frameCount, size_t &outputFrameCount)
    {
        frameCount = std::min<size_t>(frameCount, outputBuffer.size() / getChannelCount());
        aEffect->processReplacing(aEffect, inputBufferHeads.data(), outputBufferHeads.data(), frameCount);
        samplePos += frameCount;
        outputFrameCount = frameCount;
        return outputBufferHeads.data();
    }

private:
    bool init(const char *vstModulePath)
    {
        {
            wchar_t buf[MAX_PATH + 1]{};
            wchar_t *namePtr = nullptr;
            const auto r = GetFullPathName(GetWC(vstModulePath), _countof(buf), buf, &namePtr);
            if (r && namePtr)
            {
                *namePtr = 0;
                char mbBuf[_countof(buf) * 4]{};
                if (auto s = WideCharToMultiByte(CP_OEMCP, 0, buf, -1, mbBuf, sizeof(mbBuf), 0, 0))
                {
                    directoryMultiByte = mbBuf;
                }
            }
        }

        hModule = LoadLibrary(GetWC(vstModulePath));
        ASSERT_THROW(hModule, "Can't open VST DLL");

        typedef AEffect *(VstEntryProc)(audioMasterCallback);
        auto *vstEntryProc = reinterpret_cast<VstEntryProc *>(GetProcAddress(hModule, "VSTPluginMain"));
        if (!vstEntryProc)
        {
            vstEntryProc = reinterpret_cast<VstEntryProc *>(GetProcAddress(hModule, "main"));
        }
        ASSERT_THROW(vstEntryProc, "VST's entry point not found");

        aEffect = vstEntryProc(hostCallback_static);
        ASSERT_THROW(aEffect && aEffect->magic == kEffectMagic, "Not a VST plugin");
        ASSERT_THROW(flagsIsSynth(), "Not a VST Synth");
        aEffect->user = this;

        inputBuffer.resize(aEffect->numInputs * getBlockSize());
        for (int i = 0; i < aEffect->numInputs; ++i)
        {
            inputBufferHeads.push_back(&inputBuffer[i * getBlockSize()]);
        }

        outputBuffer.resize(aEffect->numOutputs * getBlockSize());
        for (int i = 0; i < aEffect->numOutputs; ++i)
        {
            outputBufferHeads.push_back(&outputBuffer[i * getBlockSize()]);
        }

        dispatcher(effOpen);
        dispatcher(effSetSampleRate, 0, 0, 0, static_cast<float>(getSampleRate()));
        dispatcher(effSetBlockSize, 0, getBlockSize());
        dispatcher(effSetProcessPrecision, 0, kVstProcessPrecision32);
        dispatcher(effMainsChanged, 0, 1);
        dispatcher(effStartProcess);

        return true;
    }

    void cleanup()
    {
        if (editorHwnd)
        {
            dispatcher(effEditClose);
            editorHwnd = nullptr;
        }
        dispatcher(effStopProcess);
        dispatcher(effMainsChanged, 0, 0);
        dispatcher(effClose);
        if (hModule)
        {
            FreeLibrary(hModule);
            hModule = nullptr;
        }
    }

    static VstIntPtr hostCallback_static(
        AEffect *effect, VstInt32 opcode, VstInt32 index, VstIntPtr value, void *ptr, float opt)
    {
        if (effect && effect->user)
        {
            auto *that = static_cast<VstPlugin *>(effect->user);
            return that->hostCallback(opcode, index, value, ptr, opt);
        }

        switch (opcode)
        {
        case audioMasterVersion:
            return kVstVersion;
        default:
            return 0;
        }
    }

    // Source - https://stackoverflow.com/a/8032108
    // Posted by Andrew Shepherd
    // Retrieved 2026-02-28, License - CC BY-SA 3.0

    const wchar_t *GetWC(const char *c)
    {
        const size_t cSize = strlen(c) + 1;
        wchar_t *wc = new wchar_t[cSize];
        mbstowcs(wc, c, cSize);

        return wc;
    }

    VstIntPtr hostCallback(VstInt32 opcode, VstInt32 index, VstIntPtr value, void *ptr, float)
    {
        switch (opcode)
        {
        default:
            break;
        case audioMasterVersion:
            return kVstVersion;
        case audioMasterCurrentId:
            return aEffect->uniqueID;
        case audioMasterGetSampleRate:
            return getSampleRate();
        case audioMasterGetBlockSize:
            return getBlockSize();
        case audioMasterGetCurrentProcessLevel:
            return kVstProcessLevelUnknown;
        case audioMasterGetAutomationState:
            return kVstAutomationOff;
        case audioMasterGetLanguage:
            return kVstLangEnglish;
        case audioMasterGetVendorVersion:
            return getVendorVersion();

        case audioMasterGetVendorString:
            strcpy_s(static_cast<char *>(ptr), kVstMaxVendorStrLen, getVendorString());
            return 1;

        case audioMasterGetProductString:
            strcpy_s(static_cast<char *>(ptr), kVstMaxProductStrLen, getProductString());
            return 1;

        case audioMasterGetTime:
            timeinfo.flags = 0;
            timeinfo.samplePos = getSamplePos();
            timeinfo.sampleRate = getSampleRate();
            return reinterpret_cast<VstIntPtr>(&timeinfo);

        case audioMasterGetDirectory:
            return reinterpret_cast<VstIntPtr>(directoryMultiByte.c_str());

        case audioMasterIdle:
            if (editorHwnd)
            {
                dispatcher(effEditIdle);
            }
            break;

        case audioMasterSizeWindow:
            if (editorHwnd)
            {
                RECT rc{};
                GetWindowRect(editorHwnd, &rc);
                rc.right = rc.left + static_cast<int>(index);
                rc.bottom = rc.top + static_cast<int>(value);
                resizeEditor(rc);
            }
            break;

        case audioMasterCanDo:
            for (const char **pp = getCapabilities(); *pp; ++pp)
            {
                if (strcmp(*pp, static_cast<const char *>(ptr)) == 0)
                {
                    return 1;
                }
            }
            return 0;
        }
        return 0;
    }

protected:
    HWND editorHwnd{nullptr};
    HMODULE hModule{nullptr};
    AEffect *aEffect{nullptr};
    std::atomic<size_t> samplePos{0};
    VstTimeInfo timeinfo{};
    std::string directoryMultiByte{};

    std::vector<float> outputBuffer;
    std::vector<float *> outputBufferHeads;
    std::vector<float> inputBuffer;
    std::vector<float *> inputBufferHeads;

    std::vector<VstMidiEvent> vstMidiEvents;
    std::vector<char> vstEventBuffer;

    struct
    {
        std::vector<VstMidiEvent> events;
        std::unique_lock<std::mutex> lock() const
        {
            return std::unique_lock<std::mutex>(mutex);
        }

    private:
        std::mutex mutable mutex;
    } vstMidi;
};

struct SocketAudioSender
{
    using RefillFunc = std::function<bool(float *, uint32_t, const WAVEFORMATEX *)>;

    SocketAudioSender(RefillFunc refillFunc, const char *filename = "audio_output.raw")
        : refillFunc(refillFunc)
    {

        serverSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (serverSocket == INVALID_SOCKET)
        {
            std::cout << "Error at socket(): " << WSAGetLastError() << std::endl;
            return;
        }
        sockaddr_in service;
        service.sin_family = AF_INET;
        service.sin_addr.s_addr = inet_addr(STATIC_ADRESS);
        service.sin_port = htons(PORT_AUDIO_SEND);
        if (bind(serverSocket, reinterpret_cast<SOCKADDR *>(&service), sizeof(service)) == SOCKET_ERROR)
        {
            std::cout << "bind() failed: " << WSAGetLastError() << std::endl;
            closesocket(serverSocket);
            return;
        }
        if (listen(serverSocket, 1) == SOCKET_ERROR)
        {
            std::cout << "listen(): Error listening on socket: " << WSAGetLastError() << std::endl;
        }
        std::ofstream startedOut(".started");
        if (startedOut)
        {
            startedOut << "OK" << std::endl;
        }
        startedOut.close();
        std::cout << "Waiting for connection... (SAS)" << std::endl;
        acceptSocket = accept(serverSocket, nullptr, nullptr);

        if (acceptSocket == INVALID_SOCKET)
        {
            std::cout << "accept failed: " << WSAGetLastError() << std::endl;
            closesocket(serverSocket);
            return;
        }

        std::cout << "Connected!" << std::endl;

        // Setup WAVEFORMATEX
        mixFormat.wFormatTag = 0x0003;
        mixFormat.nChannels = 2;
        mixFormat.nSamplesPerSec = 44100;
        mixFormat.wBitsPerSample = 32;
        mixFormat.nBlockAlign = mixFormat.nChannels * mixFormat.wBitsPerSample / 8;
        mixFormat.nAvgBytesPerSec = mixFormat.nSamplesPerSec * mixFormat.nBlockAlign;
        mixFormat.cbSize = 0;

        running = true;
        audioThread = std::thread(&SocketAudioSender::threadFunc, this);
    }
    ~SocketAudioSender()
    {
        running = false;
        if (audioThread.joinable())
        {
            audioThread.join();
        }
    }

private:
    void threadFunc()
    {
        const uint32_t framesPerBuffer = 1024;
        std::vector<float> buffer(framesPerBuffer * mixFormat.nChannels);

        while (running)
        {
            if (refillFunc(buffer.data(), framesPerBuffer, &mixFormat))
            {
                int bytesToSend = static_cast<int>(framesPerBuffer * mixFormat.nChannels * sizeof(float));
                int bytesSent = 0;
                while (bytesSent < bytesToSend)
                {
                    int result = send(acceptSocket, reinterpret_cast<const char *>(buffer.data()) + bytesSent, bytesToSend - bytesSent, 0);
                    if (result == SOCKET_ERROR)
                    {
                        std::cout << "send failed: " << WSAGetLastError() << std::endl;
                        closesocket(acceptSocket);
                        WSACleanup();
                        return;
                    }
                    bytesSent += result;
                }
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    }

    RefillFunc refillFunc;
    WAVEFORMATEX mixFormat{};
    std::atomic<bool> running{false};
    std::thread audioThread;
    SOCKET acceptSocket;
    SOCKET serverSocket;
};

// struct Wasapi
// {
//     using RefillFunc = std::function<bool(float *, uint32_t, const WAVEFORMATEX *)>;

//     Wasapi(RefillFunc refillFunc, int hnsBufferDuration = 30 * 10000)
//     {
//         HRESULT hr = S_OK;

//         hClose = CreateEventEx(0, 0, 0, EVENT_MODIFY_STATE | SYNCHRONIZE);
//         hRefillEvent = CreateEventEx(0, 0, 0, EVENT_MODIFY_STATE | SYNCHRONIZE);
//         this->refillFunc = refillFunc;

//         hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), 0, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&mmDeviceEnumerator));
//         ASSERT_THROW(SUCCEEDED(hr), "CoCreateInstance(MMDeviceEnumerator) failed");

//         hr = mmDeviceEnumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &mmDevice);
//         ASSERT_THROW(SUCCEEDED(hr), "mmDeviceEnumerator->GetDefaultAudioEndpoint() failed");

//         hr = mmDevice->Activate(__uuidof(IAudioClient), CLSCTX_INPROC_SERVER, 0, reinterpret_cast<void **>(&audioClient));
//         ASSERT_THROW(SUCCEEDED(hr), "mmDevice->Activate() failed");

//         audioClient->GetMixFormat(&mixFormat);

//         hr = audioClient->Initialize(
//             AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST, hnsBufferDuration, 0, mixFormat, nullptr);
//         ASSERT_THROW(SUCCEEDED(hr), "audioClient->Initialize() failed");

//         hr = audioClient->GetService(__uuidof(IAudioRenderClient), reinterpret_cast<void **>(&audioRenderClient));
//         ASSERT_THROW(SUCCEEDED(hr), "audioClient->GetService(IAudioRenderClient) failed");

//         hr = audioClient->GetBufferSize(&bufferFrameCount);
//         ASSERT_THROW(SUCCEEDED(hr), "audioClient->GetBufferSize() failed");

//         hr = audioClient->SetEventHandle(hRefillEvent);
//         ASSERT_THROW(SUCCEEDED(hr), "audioClient->SetEventHandle() failed");

//         BYTE *data = nullptr;
//         hr = audioRenderClient->GetBuffer(bufferFrameCount, &data);
//         ASSERT_THROW(SUCCEEDED(hr), "audioRenderClient->GetBuffer() failed");

//         hr = audioRenderClient->ReleaseBuffer(bufferFrameCount, AUDCLNT_BUFFERFLAGS_SILENT);
//         ASSERT_THROW(SUCCEEDED(hr), "audioRenderClient->ReleaseBuffer() failed");

//         unsigned threadId = 0;
//         hThread = reinterpret_cast<HANDLE>(_beginthreadex(0, 0, threadFunc_static, reinterpret_cast<void *>(this), 0, &threadId));

//         hr = audioClient->Start();
//         ASSERT_THROW(SUCCEEDED(hr), "audioClient->Start() failed");
//     }

//     ~Wasapi()
//     {
//         if (hClose)
//         {
//             SetEvent(hClose);
//             if (hThread)
//             {
//                 WaitForSingleObject(hThread, INFINITE);
//             }
//         }

//         CLOSE_HANDLE(hThread);
//         CLOSE_HANDLE(hClose);
//         CLOSE_HANDLE(hRefillEvent);

//         if (mixFormat)
//         {
//             CoTaskMemFree(mixFormat);
//             mixFormat = nullptr;
//         }

//         RELEASE(audioRenderClient);
//         RELEASE(audioClient);
//         RELEASE(mmDevice);
//         RELEASE(mmDeviceEnumerator);
//     }

// private:
//     static unsigned __stdcall threadFunc_static(void *arg)
//     {
//         return reinterpret_cast<Wasapi *>(arg)->threadFunc();
//     }

//     unsigned threadFunc()
//     {
//         ComInit comInit{};
//         const HANDLE events[2] = {hClose, hRefillEvent};
//         for (bool run = true; run;)
//         {
//             const auto r = WaitForMultipleObjects(_countof(events), events, FALSE, INFINITE);
//             if (WAIT_OBJECT_0 == r)
//             { // hClose
//                 run = false;
//             }
//             else if (WAIT_OBJECT_0 + 1 == r)
//             { // hRefillEvent
//                 UINT32 c = 0;
//                 audioClient->GetCurrentPadding(&c);

//                 const auto a = bufferFrameCount - c;
//                 float *data = nullptr;
//                 audioRenderClient->GetBuffer(a, reinterpret_cast<BYTE **>(&data));

//                 const auto r = refillFunc(data, a, mixFormat);
//                 audioRenderClient->ReleaseBuffer(a, r ? 0 : AUDCLNT_BUFFERFLAGS_SILENT);
//             }
//         }
//         return 0;
//     }

//     HANDLE hThread{nullptr};
//     IMMDeviceEnumerator *mmDeviceEnumerator{nullptr};
//     IMMDevice *mmDevice{nullptr};
//     IAudioClient *audioClient{nullptr};
//     IAudioRenderClient *audioRenderClient{nullptr};
//     WAVEFORMATEX *mixFormat{nullptr};
//     HANDLE hRefillEvent{nullptr};
//     HANDLE hClose{nullptr};
//     UINT32 bufferFrameCount{0};
//     RefillFunc refillFunc{};
// };

// This function is called from Wasapi::threadFunc() which is running in audio thread.
bool refillCallback(VstPlugin &vstPlugin, float *const data, uint32_t availableFrameCount, const WAVEFORMATEX *const mixFormat)
{
    vstPlugin.processEvents();

    const auto nDstChannels = mixFormat->nChannels;
    const auto nSrcChannels = vstPlugin.getChannelCount();
    const auto vstSamplesPerBlock = vstPlugin.getBlockSize();

    int ofs = 0;
    while (availableFrameCount > 0)
    {
        size_t outputFrameCount = 0;
        float **vstOutput = vstPlugin.processAudio(availableFrameCount, outputFrameCount);

        // VST vstOutput[][] format :
        //  vstOutput[a][b]
        //      channel = a % vstPlugin.getChannelCount()
        //      frame   = b + floor(a/2) * vstPlugin.getBlockSize()

        // wasapi data[] format :
        //  data[x]
        //      channel = x % mixFormat->nChannels
        //      frame   = floor(x / mixFormat->nChannels);

        const auto nFrame = outputFrameCount;
        for (size_t iFrame = 0; iFrame < nFrame; ++iFrame)
        {
            for (size_t iChannel = 0; iChannel < nDstChannels; ++iChannel)
            {
                const int sChannel = iChannel % nSrcChannels;
                const int vstOutputPage = (iFrame / vstSamplesPerBlock) * sChannel + sChannel;
                const int vstOutputIndex = (iFrame % vstSamplesPerBlock);
                const int wasapiWriteIndex = iFrame * nDstChannels + iChannel;
                *(data + ofs + wasapiWriteIndex) = vstOutput[vstOutputPage][vstOutputIndex];
            }
        }

        availableFrameCount -= nFrame;
        ofs += nFrame * nDstChannels;
    }
    return true;
}

void mainLoop(const char *dllFilename)
{
    VstPlugin vstPlugin{dllFilename};
    SocketAudioSender wasapi{[&vstPlugin](float *const data, uint32_t availableFrameCount, const WAVEFORMATEX *const mixFormat)
                             {
                                 return refillCallback(vstPlugin, data, availableFrameCount, mixFormat);
                             }};

    struct Key
    {
        Key(int midiNote) : midiNote{midiNote} {}
        int midiNote{};
        bool status{false};
    };

    std::cout << "Started." << std::endl;

    bool run = true;

    SOCKET serverSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (serverSocket == INVALID_SOCKET)
    {
        std::cout << "Error at socket(): " << WSAGetLastError() << std::endl;
        return;
    }

    std::cout << "Waiting for connection..." << std::endl;
    sockaddr_in service;
    service.sin_family = AF_INET;
    service.sin_addr.s_addr = inet_addr(STATIC_ADRESS);
    service.sin_port = htons(PORT_NOTE_RECEIVE);
    if (bind(serverSocket, reinterpret_cast<SOCKADDR *>(&service), sizeof(service)) == SOCKET_ERROR)
    {
        std::cout << "bind() failed: " << WSAGetLastError() << std::endl;
        closesocket(serverSocket);
        return;
    }

    std::cout << "Listening on " << STATIC_ADRESS << ":" << PORT_NOTE_RECEIVE << "..." << std::endl;

    if (listen(serverSocket, 1) == SOCKET_ERROR)
    {
        std::cout << "listen(): Error listening on socket: " << WSAGetLastError() << std::endl;
    }

    std::cout << "Waiting for connection..." << std::endl;

    SOCKET acceptSocket = INVALID_SOCKET;
    std::ofstream finishedStarted(".finished_start");
    if (finishedStarted)
    {
        finishedStarted << "OK" << std::endl;
    }
    finishedStarted.close();

    std::cout << "Startup complete!" << std::endl;

    acceptSocket = accept(serverSocket, nullptr, nullptr);

    if (acceptSocket == INVALID_SOCKET)
    {
        std::cout << "accept failed: " << WSAGetLastError() << std::endl;
        closesocket(serverSocket);
        return;
    }

    std::string recvAccum;
    recvAccum.reserve(2048);

    while (run)
    {
        char recvbuf[512];
        int result = recv(acceptSocket, recvbuf, sizeof(recvbuf), 0);

        if (result > 0)
        {
            recvAccum.append(recvbuf, recvbuf + result);

            size_t nl = 0;
            while ((nl = recvAccum.find('\n')) != std::string::npos)
            {
                std::string line = recvAccum.substr(0, nl);
                recvAccum.erase(0, nl + 1);

                const size_t c = line.find(':');
                if (c == std::string::npos || c + 1 >= line.size())
                {
                    std::cout << "Malformed MIDI message: " << line << std::endl;
                    continue;
                }

                const std::string key = line.substr(0, c);
                const char onOff = line[c + 1];
                const int vel = (c + 2 < line.size()) ? std::atoi(line.c_str() + c + 2) : 100;
                const int midiNote = std::atoi(key.c_str());
                const bool on = (onOff == '1');

                // std::cout << "MIDI: note=" << midiNote << " on=" << on << " vel=" << vel << std::endl;
                vstPlugin.sendMidiNote(0, midiNote, on, vel);
            }
        }
        else if (result == 0)
        {
            std::cout << "Connection closing..." << std::endl;
            run = false;
        }
        else
        {
            std::cout << "recv failed: " << WSAGetLastError() << std::endl;
            run = false;
        }
    }

    closesocket(acceptSocket);
    closesocket(serverSocket);
}

int main(int argc, char *argv[])
{
    if (argc < 2)
    {
        std::cout << "Usage : " << argv[0] << " <VST Synth DLL>" << std::endl;
        return 1;
    }

    // Initialize Winsock ONCE at startup
    WSADATA wsaData;
    int wsaerr;
    WORD wVersionRequested = MAKEWORD(2, 2);
    wsaerr = WSAStartup(wVersionRequested, &wsaData);
    if (wsaerr != 0)
    {
        std::cout << "WSAStartup failed: " << wsaerr << std::endl;
        return 1;
    }

    try
    {
        mainLoop(argv[1]);
    }
    catch (std::exception &e)
    {
        std::cout << "Exception : " << e.what() << std::endl;
    }
    WSACleanup();
}