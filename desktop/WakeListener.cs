using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Speech.AudioFormat;
using System.Speech.Recognition;
using System.Threading;

// Standalone, local-only Windows recognizer. No network calls or recordings.
// Only control events leave this process; background transcripts are discarded.
//   --phrases "Nova|Hey Nova"  wake phrases (default: Atlas and its common mishearings)
//   --candidates               two-stage mode: report every possible wake phrase with its audio and keep
//                              listening; the app confirms it with a local Whisper check. Without it the
//                              listener decides alone (dictation competes with the phrases) and exits.
//   --device "<name>"          microphone to listen on, matched by name (default: the Windows default input)
//   --levels                   report the input level a few times a second (name test and input check)
//   --calibrate                report every wake-phrase match with its confidence and keep listening
//   --list-devices             print the microphones Windows offers and exit
//   --wave <file>              read a 16-bit PCM WAV instead of the microphone (tests)
//   --probe                    report whether an English recognizer is installed
// Written for the C# 5 compiler that ships with .NET Framework.
internal static class WakeListener {
    private static readonly ManualResetEvent Finished = new ManualResetEvent(false), Completed = new ManualResetEvent(false);
    private static int detected;
    private static readonly object Output = new object();
    private static readonly string[] DefaultPhrases = { "Atlas", "Hey Atlas", "Atlus", "Hey Atlus", "Atless", "Hey Atless" };
    // The candidate stage is loose enough to catch nearly every real wake; the Whisper check removes
    // the false ones. Alone, the listener needs a stricter confidence.
    private const float CandidateConfidence = 0.5f, AloneConfidence = 0.6f;
    internal static string Json(string text) { return "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
    internal static void Line(string json) { lock (Output) { Console.WriteLine(json); Console.Out.Flush(); } }
    private static void Emit(string type) { Line("{\"type\":\"" + type + "\"}"); }
    private static string Number(float value) { return value.ToString("0.00", CultureInfo.InvariantCulture); }
    public static int Main(string[] args) {
        string[] phrases = DefaultPhrases; string wave = null, device = null; bool calibrate = false, probe = false, levels = false, list = false, candidates = false;
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "--probe") probe = true;
            else if (args[i] == "--calibrate") calibrate = true;
            else if (args[i] == "--candidates") candidates = true;
            else if (args[i] == "--levels") levels = true;
            else if (args[i] == "--list-devices") list = true;
            else if (args[i] == "--wave" && i + 1 < args.Length) wave = args[++i];
            else if (args[i] == "--device" && i + 1 < args.Length) device = args[++i];
            else if (args[i] == "--phrases" && i + 1 < args.Length) {
                var parsed = args[++i].Split('|').Select(p => p.Trim()).Where(p => p.Length > 0 && p.Length <= 40).Distinct().Take(12).ToArray();
                if (parsed.Length > 0) phrases = parsed;
            }
        }
        if (list) { Line("{\"type\":\"devices\",\"devices\":[" + string.Join(",", Microphone.Names().Select(Json).ToArray()) + "]}"); return 0; }
        var accepted = new HashSet<string>(phrases.Select(p => p.ToLowerInvariant()));
        Microphone mic = null; AudioPipe input = null;
        try {
            var info = SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "en");
            if (info == null) { Emit("missing-recognizer"); return 2; }
            if (probe) { Emit("available"); return 0; }
            using (var engine = new SpeechRecognitionEngine(info)) {
                var builder = new GrammarBuilder(); builder.Culture = info.Culture; builder.Append(new Choices(phrases));
                var wake = new Grammar(builder); wake.Name = "wake";
                engine.LoadGrammar(wake);
                // Alone, a competing dictation grammar keeps ordinary speech from being forced into the wake
                // phrases, but it also swallows about half of real wakes. In candidate mode the Whisper check
                // rejects ordinary speech instead, so every plausible wake reaches it.
                if (!candidates) { var background = new DictationGrammar(); background.Name = "background"; engine.LoadGrammar(background); }
                engine.SpeechRecognized += (sender, e) => {
                    if (e.Result.Grammar.Name != "wake") return;
                    var text = e.Result.Text.Trim().TrimEnd('.', '!', '?');
                    if (!accepted.Contains(text.ToLowerInvariant())) return;
                    float confidence = e.Result.Confidence;
                    if (candidates) {
                        if (confidence < CandidateConfidence || input == null) return;
                        // A little audio either side, so the check hears the whole phrase.
                        long start = (long)((e.Result.Audio.AudioPosition.TotalSeconds - 0.5) * Microphone.Rate) * 2;
                        long end = (long)((e.Result.Audio.AudioPosition + e.Result.Audio.Duration).TotalSeconds * Microphone.Rate + Microphone.Rate / 2) * 2;
                        var clip = input.Recent(start, end);
                        if (clip.Length < Microphone.Rate / 5) return;
                        Line("{\"type\":\"candidate\",\"phrase\":" + Json(text) + ",\"confidence\":" + Number(confidence) + ",\"wav\":\"" + Convert.ToBase64String(Wave(clip)) + "\"}");
                        return;
                    }
                    if (calibrate) { Line("{\"type\":\"heard\",\"phrase\":" + Json(text) + ",\"confidence\":" + Number(confidence) + "}"); return; }
                    if (confidence >= AloneConfidence && Interlocked.Exchange(ref detected, 1) == 0) { Emit("detected"); Finished.Set(); }
                };
                engine.RecognizeCompleted += (sender, e) => { if (e.Error != null) { Console.Error.WriteLine(e.Error); Emit("recognition-error"); } Completed.Set(); Finished.Set(); };
                if (wave != null) {
                    input = ReadWave(wave);
                    if (input == null) { Emit("unsupported-wave"); return 5; }
                } else {
                    // Our own capture instead of SetInputToDefaultAudioDevice, so the user can pick the
                    // microphone and the app can see whether any sound is arriving at all.
                    mic = Microphone.Open(device, levels);
                    if (mic == null) { Emit("unavailable"); return 4; }
                    input = mic.Stream;
                    Line("{\"type\":\"device\",\"name\":" + Json(mic.Name) + ",\"matched\":" + (mic.Matched ? "true" : "false") + "}");
                }
                engine.SetInputToAudioStream(input, new SpeechAudioFormatInfo(Microphone.Rate, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
                // EOF on the parent's stdin pipe means the app has exited (or the test was cancelled).
                if (wave == null) {
                    var watch = new Thread(() => { try { Console.ReadLine(); } catch {} Finished.Set(); });
                    watch.IsBackground = true; watch.Start();
                }
                engine.RecognizeAsync(RecognizeMode.Multiple); Emit("ready");
                Finished.WaitOne();
                // Cancel is asynchronous: closing the input ends the pending read, then wait for
                // recognition to finish before detaching it.
                engine.RecognizeAsyncCancel();
                if (mic != null) mic.Dispose(); else input.Close();
                Completed.WaitOne(2000);
                try { engine.SetInputToNull(); } catch (InvalidOperationException) {}
            }
            Emit("stopped"); return 0;
        } catch (UnauthorizedAccessException) { Emit("microphone-denied"); return 3; }
          catch (Exception error) { Console.Error.WriteLine(error); Emit("unavailable"); return 4; }
          finally { if (mic != null) mic.Dispose(); }
    }

    // A test recording goes through the same stream as the microphone: any 16-bit PCM WAV, mixed down
    // to mono and resampled to 16 kHz.
    private static AudioPipe ReadWave(string path) {
        var bytes = File.ReadAllBytes(path);
        if (bytes.Length < 12 || bytes[0] != 'R' || bytes[8] != 'W') return null;
        int channels = 0, rate = 0, bits = 0, at = 12;
        while (at + 8 <= bytes.Length) {
            int size = BitConverter.ToInt32(bytes, at + 4);
            if (size < 0) break;
            string id = System.Text.Encoding.ASCII.GetString(bytes, at, 4);
            if (id == "fmt " && size >= 16) {
                if (BitConverter.ToInt16(bytes, at + 8) != 1) return null;
                channels = BitConverter.ToInt16(bytes, at + 10); rate = BitConverter.ToInt32(bytes, at + 12); bits = BitConverter.ToInt16(bytes, at + 22);
            } else if (id == "data") {
                if (bits != 16 || channels < 1 || rate < 8000) return null;
                int frames = Math.Max(0, Math.Min(size, bytes.Length - at - 8)) / (2 * channels);
                var mono = new double[frames];
                for (int f = 0; f < frames; f++) { double sum = 0; for (int c = 0; c < channels; c++) sum += BitConverter.ToInt16(bytes, at + 8 + (f * channels + c) * 2); mono[f] = sum / channels; }
                int outFrames = (int)((long)frames * Microphone.Rate / rate);
                var pcm = new byte[outFrames * 2];
                for (int i = 0; i < outFrames; i++) {
                    double src = (double)i * rate / Microphone.Rate; int j = (int)src; double t = src - j;
                    double v = j + 1 < frames ? mono[j] * (1 - t) + mono[j + 1] * t : (j < frames ? mono[j] : 0);
                    short sample = (short)Math.Max(short.MinValue, Math.Min(short.MaxValue, Math.Round(v)));
                    pcm[2 * i] = (byte)sample; pcm[2 * i + 1] = (byte)(sample >> 8);
                }
                var pipe = new AudioPipe(pcm.Length + Microphone.Rate * 2);
                pipe.Write(pcm);
                // Trailing silence lets the recognizer finish the last phrase before the stream ends.
                pipe.Write(new byte[Microphone.Rate * 2]);
                pipe.Close();
                return pipe;
            }
            at += 8 + size + (size & 1);
        }
        return null;
    }
    private static byte[] Wave(byte[] pcm) {
        var output = new MemoryStream(44 + pcm.Length);
        var w = new BinaryWriter(output);
        w.Write(new[] { 'R', 'I', 'F', 'F' }); w.Write(36 + pcm.Length); w.Write(new[] { 'W', 'A', 'V', 'E' });
        w.Write(new[] { 'f', 'm', 't', ' ' }); w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(Microphone.Rate); w.Write(Microphone.Rate * 2); w.Write((short)2); w.Write((short)16);
        w.Write(new[] { 'd', 'a', 't', 'a' }); w.Write(pcm.Length); w.Write(pcm);
        w.Flush(); return output.ToArray();
    }
}

// 16 kHz mono PCM from one waveIn device, fed to the recognizer through a blocking stream.
internal sealed class Microphone : IDisposable {
    public const int Rate = 16000;
    private const int BufferBytes = Rate / 10 * 2; // 100 ms
    private const int BufferCount = 4;
    private const int CallbackEvent = 0x00050000, HeaderDone = 1;
    private static readonly IntPtr WaveMapper = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Caps { public short Mid, Pid; public int Version; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name; public int Formats; public short Channels, Reserved; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Format { public short Tag, Channels; public int Rate, BytesPerSecond; public short Align, Bits, Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Header { public IntPtr Data; public int Length, Recorded; public IntPtr User; public int Flags, Loops; public IntPtr Next, Reserved; }

    [DllImport("winmm.dll")] private static extern int waveInGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "waveInGetDevCapsW")] private static extern int waveInGetDevCaps(IntPtr id, ref Caps caps, int size);
    [DllImport("winmm.dll")] private static extern int waveInOpen(out IntPtr handle, IntPtr id, ref Format format, IntPtr callback, IntPtr instance, int flags);
    [DllImport("winmm.dll")] private static extern int waveInPrepareHeader(IntPtr handle, IntPtr header, int size);
    [DllImport("winmm.dll")] private static extern int waveInUnprepareHeader(IntPtr handle, IntPtr header, int size);
    [DllImport("winmm.dll")] private static extern int waveInAddBuffer(IntPtr handle, IntPtr header, int size);
    [DllImport("winmm.dll")] private static extern int waveInStart(IntPtr handle);
    [DllImport("winmm.dll")] private static extern int waveInReset(IntPtr handle);
    [DllImport("winmm.dll")] private static extern int waveInClose(IntPtr handle);

    public static string[] Names() {
        var names = new List<string>();
        int count = waveInGetNumDevs();
        for (int i = 0; i < count; i++) {
            var caps = new Caps();
            if (waveInGetDevCaps(new IntPtr(i), ref caps, Marshal.SizeOf(typeof(Caps))) == 0) names.Add((caps.Name ?? "").Trim());
        }
        return names.ToArray();
    }
    // waveIn names are cut to 31 characters, so a full name from the app matches the device whose
    // name it starts with. No match falls back to the Windows default input.
    private static int Find(string wanted, string[] names) {
        if (string.IsNullOrEmpty(wanted)) return -1;
        int best = -1, length = 0;
        for (int i = 0; i < names.Length; i++) {
            var name = names[i];
            if (name.Length > length && wanted.StartsWith(name, StringComparison.OrdinalIgnoreCase)) { best = i; length = name.Length; }
        }
        return best;
    }

    public readonly AudioPipe Stream = new AudioPipe(Rate * 2 * 10); // keeps the last 10 s for wake checks
    public string Name { get; private set; }
    public bool Matched { get; private set; }
    private IntPtr handle;
    private readonly IntPtr[] headers = new IntPtr[BufferCount];
    private readonly AutoResetEvent ready = new AutoResetEvent(false);
    private readonly bool levels;
    private volatile bool running;
    private Thread pump;

    private Microphone(bool levels) { this.levels = levels; }

    public static Microphone Open(string wanted, bool levels) {
        var names = Names();
        int index = Find(wanted, names);
        var mic = new Microphone(levels);
        mic.Matched = index >= 0;
        mic.Name = index >= 0 ? names[index] : "Windows default";
        var format = new Format { Tag = 1, Channels = 1, Rate = Rate, BytesPerSecond = Rate * 2, Align = 2, Bits = 16, Extra = 0 };
        IntPtr handle;
        int result = waveInOpen(out handle, index >= 0 ? new IntPtr(index) : WaveMapper, ref format, mic.ready.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, CallbackEvent);
        if (result != 0) return null;
        mic.handle = handle;
        int size = Marshal.SizeOf(typeof(Header));
        for (int i = 0; i < BufferCount; i++) {
            var header = new Header { Data = Marshal.AllocHGlobal(BufferBytes), Length = BufferBytes };
            mic.headers[i] = Marshal.AllocHGlobal(size);
            Marshal.StructureToPtr(header, mic.headers[i], false);
            waveInPrepareHeader(handle, mic.headers[i], size);
            waveInAddBuffer(handle, mic.headers[i], size);
        }
        mic.running = true;
        mic.pump = new Thread(mic.Pump); mic.pump.IsBackground = true; mic.pump.Start();
        if (waveInStart(handle) != 0) { mic.Dispose(); return null; }
        return mic;
    }

    private void Pump() {
        int size = Marshal.SizeOf(typeof(Header));
        int flagsAt = Marshal.OffsetOf(typeof(Header), "Flags").ToInt32(), recordedAt = Marshal.OffsetOf(typeof(Header), "Recorded").ToInt32();
        double sum = 0; int peak = 0, samples = 0;
        while (running) {
            ready.WaitOne(200);
            for (int i = 0; i < BufferCount && running; i++) {
                var header = headers[i];
                if ((Marshal.ReadInt32(header, flagsAt) & HeaderDone) == 0) continue;
                int recorded = Marshal.ReadInt32(header, recordedAt);
                var data = new byte[recorded];
                Marshal.Copy(Marshal.ReadIntPtr(header), data, 0, recorded);
                Stream.Write(data);
                if (levels) {
                    for (int s = 0; s + 1 < recorded; s += 2) { int v = (short)(data[s] | (data[s + 1] << 8)); sum += (double)v * v; peak = Math.Max(peak, Math.Abs(v)); samples++; }
                    if (samples >= Rate / 5) { // five reports a second
                        double rms = Math.Sqrt(sum / samples) / 32768.0, top = peak / 32768.0;
                        WakeListener.Line("{\"type\":\"level\",\"rms\":" + rms.ToString("0.00000", CultureInfo.InvariantCulture) + ",\"peak\":" + top.ToString("0.00000", CultureInfo.InvariantCulture) + "}");
                        sum = 0; peak = 0; samples = 0;
                    }
                }
                Marshal.WriteInt32(header, flagsAt, Marshal.ReadInt32(header, flagsAt) & ~HeaderDone);
                waveInAddBuffer(handle, header, size);
            }
        }
    }
    public void Dispose() {
        if (handle == IntPtr.Zero) return;
        running = false;
        Stream.Close();
        waveInReset(handle);
        if (pump != null) pump.Join(1000);
        int size = Marshal.SizeOf(typeof(Header));
        foreach (var header in headers) {
            if (header == IntPtr.Zero) continue;
            waveInUnprepareHeader(handle, header, size);
            Marshal.FreeHGlobal(Marshal.ReadIntPtr(header));
            Marshal.FreeHGlobal(header);
        }
        waveInClose(handle);
        handle = IntPtr.Zero;
    }
}

// Read blocks until audio arrives, so the recognizer treats the microphone as an endless stream.
// Read returns 0 only after Close, which ends recognition. The most recent audio is also kept so a
// possible wake phrase can be handed to the Whisper check.
internal sealed class AudioPipe : Stream {
    private readonly Queue<byte[]> chunks = new Queue<byte[]>();
    private byte[] current; private int offset; private bool closed; private long read;
    private readonly byte[] history; private long written;
    public AudioPipe(int keep) { history = new byte[Math.Max(keep, 2)]; }
    public void Write(byte[] data) {
        lock (chunks) {
            if (closed) return;
            chunks.Enqueue(data);
            for (int i = 0; i < data.Length; i++) history[(written + i) % history.Length] = data[i];
            written += data.Length;
            Monitor.PulseAll(chunks);
        }
    }
    // Bytes [start, end) of everything written so far, clipped to what is still kept. Even length.
    public byte[] Recent(long start, long end) {
        lock (chunks) {
            start = Math.Max(Math.Max(start, 0), written - history.Length); end = Math.Min(end, written);
            start += start & 1; end -= end & 1;
            if (end <= start) return new byte[0];
            var clip = new byte[end - start];
            for (long i = start; i < end; i++) clip[i - start] = history[i % history.Length];
            return clip;
        }
    }
    public override void Close() { lock (chunks) { closed = true; Monitor.PulseAll(chunks); } base.Close(); }
    // SAPI treats a short read as the end of the stream, so fill the whole request unless closed.
    public override int Read(byte[] buffer, int start, int count) {
        int total = 0;
        lock (chunks) {
            while (total < count) {
                if (current == null || offset >= current.Length) {
                    while (chunks.Count == 0 && !closed) Monitor.Wait(chunks);
                    if (chunks.Count == 0) break;
                    current = chunks.Dequeue(); offset = 0;
                }
                int n = Math.Min(count - total, current.Length - offset);
                Buffer.BlockCopy(current, offset, buffer, start + total, n); offset += n; total += n; read += n;
            }
        }
        return total;
    }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return false; } }
    public override bool CanWrite { get { return false; } }
    // SAPI reads Length once when the stream is attached; a live microphone has no end.
    public override long Length { get { return -1; } }
    // SAPI asks where it is (Seek(0, Current)) but never moves; report bytes read so far.
    public override long Position { get { lock (chunks) return read; } set { } }
    public override void Flush() {}
    public override long Seek(long o, SeekOrigin origin) { return Position; }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int o, int count) { throw new NotSupportedException(); }
}
