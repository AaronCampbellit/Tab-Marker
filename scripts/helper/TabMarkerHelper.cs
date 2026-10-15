using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Windows/.NET Framework host. stdout contains native-messaging frames only.
class TabMarkerHelper {
    static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 1048576 };
    static Stream output = Console.OpenStandardOutput();
    static byte[] ReadExact(Stream input, int count) {
        byte[] bytes = new byte[count]; int read = 0;
        while (read < count) { int n = input.Read(bytes, read, count - read); if (n == 0) throw new EndOfStreamException("Incomplete native message."); read += n; }
        return bytes;
    }
    static void Send(object value) {
        byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(value));
        if (bytes.Length > 1000000) throw new Exception("Response exceeds native message limit.");
        byte[] length = BitConverter.GetBytes(bytes.Length);
        output.Write(length, 0, 4); output.Write(bytes, 0, bytes.Length); output.Flush();
    }
    static string Quote(string value) {
        // Values are fixed paths or strictly validated tokens, never command text.
        if (value.Contains("\"") || value.Contains("\r") || value.Contains("\n")) throw new Exception("Invalid argument.");
        return "\"" + value + "\"";
    }
    static int Main(string[] args) {
        try {
            if (args.Length < 1 || !Regex.IsMatch(args[0], @"\Achrome-extension://[a-p]{32}/\z")) throw new Exception("Invalid calling extension origin.");
            Stream input = Console.OpenStandardInput();
            int size = BitConverter.ToInt32(ReadExact(input, 4), 0);
            if (size < 2 || size > 4096) throw new Exception("Invalid native message size.");
            Dictionary<string, object> request = json.Deserialize<Dictionary<string, object>>(new UTF8Encoding(false, true).GetString(ReadExact(input, size)));
            foreach (string key in request.Keys) if (key != "action" && key != "version") throw new Exception("Unsupported request field.");
            string action = request.ContainsKey("action") ? request["action"] as string : null;
            if (action != "status" && action != "check" && action != "update") throw new Exception("Unsupported helper action.");
            string version = request.ContainsKey("version") ? request["version"] as string : null;
            if (action == "update" && (version == null || !Regex.IsMatch(version, @"\A(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\z"))) throw new Exception("Expected release version is required.");
            if (action != "update" && version != null) throw new Exception("Version is only valid for an update.");
            string home = AppDomain.CurrentDomain.BaseDirectory;
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            ProcessStartInfo start = new ProcessStartInfo(shell);
            start.Arguments = "-NoLogo -NoProfile -NonInteractive -File " + Quote(Path.Combine(home, "Invoke-TabMarkerHelper.ps1")) + " -Origin " + Quote(args[0]) + " -Action " + action;
            if (version != null) start.Arguments += " -ExpectedVersion " + Quote(version);
            start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            start.StandardOutputEncoding = Encoding.UTF8; start.StandardErrorEncoding = Encoding.UTF8;
            using (Process process = new Process()) {
                process.StartInfo = start;
                StringBuilder errors = new StringBuilder();
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null && errors.Length < 4096) errors.AppendLine(e.Data); };
                process.Start(); process.BeginErrorReadLine();
                string final = null, line;
                while ((line = process.StandardOutput.ReadLine()) != null) {
                    if (line.StartsWith("TABMARKER_HELPER_JSON=", StringComparison.Ordinal)) final = line.Substring("TABMARKER_HELPER_JSON=".Length);
                    else if (line.StartsWith("TABMARKER_PROGRESS ", StringComparison.Ordinal)) Send(new { kind = "progress", message = line.Substring(19) });
                }
                process.WaitForExit();
                if (final == null) throw new Exception("Helper could not run. " + errors.ToString().Trim());
                Send(new { kind = "complete", result = json.DeserializeObject(final) });
                return process.ExitCode;
            }
        } catch (Exception error) {
            try { Send(new { kind = "complete", result = new { ok = false, error = error.Message } }); } catch { }
            return 1;
        }
    }
}
