// clanzi 창 전환 도우미. 플러그인이 한 번 띄워 두고 표준 입력으로 한 줄짜리 JSON 요청을 보낸다.
//   {"op":"vscode","folder":"clanzi","session":"<id>"}  VS Code 창을 폴더 이름으로 찾아 앞으로 가져온 뒤 그 대화를 연다
//   {"op":"pid","pid":1234,"folder":"clanzi"}           프로세스의 부모를 따라 올라가 창을 가진 앱을 앞으로 가져온다
//   {"op":"kill","pid":1234}                            claude 프로세스일 때만 하위 프로세스까지 강제 종료한다
//   {"op":"url","url":"https://..."}                    기본 브라우저로 연다
// 응답은 한 줄: focused:switch | focused:attach | opened | not-found | blocked | killed | not-claude:<이름> | error:<메시지>
// Windows는 백그라운드 프로세스의 창 전환을 막으므로, 막히면 현재 앞 창의 입력 스레드에 잠시 붙어서 전환 권한을 얻는다.
//
// Windows에 기본으로 있는 .NET Framework 4 C# 컴파일러(C# 5)로 빌드한다(scripts/build.mjs).
// PowerShell로 띄우면 시작에 1초쯤 걸려, 처음 키를 누를 때 늦었다.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

static class FocusHelper {
    static void Main() {
        var utf8 = new UTF8Encoding(false);
        var input = new StreamReader(Console.OpenStandardInput(), utf8);
        var output = new StreamWriter(Console.OpenStandardOutput(), utf8);
        output.AutoFlush = true;
        var json = new JavaScriptSerializer();
        output.WriteLine("ready");
        string line;
        // 플러그인이 끝나 입력이 닫히면 함께 끝난다.
        while ((line = input.ReadLine()) != null) {
            string result;
            try {
                result = Handle(json.Deserialize<Dictionary<string, object>>(line));
            } catch (Exception e) {
                result = "error:" + Regex.Replace(e.Message, @"\s+", " ");
            }
            output.WriteLine(result);
        }
    }

    static string Handle(Dictionary<string, object> req) {
        switch (Str(req, "op")) {
            case "vscode": {
                string result = FocusResult(Win.FindVsCode(Str(req, "folder")));
                // 창을 못 찾았어도 URI는 연다. VS Code가 마지막으로 쓴 창에서 대화를 연다.
                string session = Str(req, "session");
                if (Regex.IsMatch(session, "^[0-9a-fA-F-]{36}$")) {
                    Open("vscode://anthropic.claude-code/open?session=" + session);
                    if (result == "not-found") result = "opened";
                }
                return result;
            }
            case "pid":
                return FocusResult(FindAncestorWindow(Int(req, "pid"), Str(req, "folder")));
            case "url": {
                // 기본 브라우저로 연다. https 주소만 받는다.
                string url = Str(req, "url");
                if (!Regex.IsMatch(url, "^https://[^\\s\"]+$")) return "error:bad url";
                Open(url);
                return "opened";
            }
            case "kill":
                return Kill(Int(req, "pid"));
            default:
                return "error:unknown op";
        }
    }

    static string Str(Dictionary<string, object> req, string key) {
        object v;
        return req.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : "";
    }

    static int Int(Dictionary<string, object> req, string key) {
        object v;
        return req.TryGetValue(key, out v) && v != null ? Convert.ToInt32(v) : 0;
    }

    static string FocusResult(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return "not-found";
        string how = Win.Focus(hwnd);
        return how == "blocked" ? "blocked" : "focused:" + how;
    }

    static void Open(string target) {
        var psi = new ProcessStartInfo(target);
        psi.UseShellExecute = true;
        using (Process.Start(psi)) { }
    }

    // 부모 프로세스를 따라 올라가며 창을 가진 첫 프로세스를 찾는다.
    // 탐색기(explorer.exe)까지 올라왔다면 터미널 앱을 지나친 것이므로 멈춘다(바탕화면·탐색기 창을 띄우지 않게).
    static IntPtr FindAncestorWindow(int pid, string folder) {
        Dictionary<int, Win.ProcInfo> procs = Win.Processes();
        var seen = new HashSet<int>();
        while (pid > 0 && seen.Add(pid)) {
            Win.ProcInfo info;
            if (!procs.TryGetValue(pid, out info) || string.Equals(info.Name, "explorer.exe", StringComparison.OrdinalIgnoreCase)) break;
            IntPtr hwnd = Win.FindByProcess((uint)pid, folder);
            if (hwnd != IntPtr.Zero) return hwnd;
            pid = info.ParentId;
        }
        return IntPtr.Zero;
    }

    // 세션이 끝난 뒤 같은 PID를 다른 프로그램이 받았을 수 있으니 claude 프로세스일 때만 끈다.
    static string Kill(int pid) {
        if (pid <= 0) return "not-found";
        Process target;
        try {
            target = Process.GetProcessById(pid);
        } catch (ArgumentException) {
            return "not-found";
        }
        using (target) {
            if (!string.Equals(target.ProcessName, "claude", StringComparison.OrdinalIgnoreCase)) return "not-claude:" + target.ProcessName;
        }
        var psi = new ProcessStartInfo("taskkill.exe", "/PID " + pid + " /T /F");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        // 출력을 받아 버린다. 그대로 두면 이 도우미의 응답 줄에 섞인다.
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        using (Process p = Process.Start(psi)) {
            p.StandardOutput.ReadToEnd();
            p.StandardError.ReadToEnd();
            p.WaitForExit();
            return p.ExitCode == 0 ? "killed" : "error:taskkill " + p.ExitCode;
        }
    }
}

static class Win {
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")] static extern bool Process32First(IntPtr snap, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")] static extern bool Process32Next(IntPtr snap, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    const string VsCodeSuffix = " - Visual Studio Code";

    public struct ProcInfo {
        public string Name;
        public int ParentId;
    }

    /** 실행 중인 프로세스의 이름과 부모 PID. 스냅샷 한 번으로 읽는다. */
    public static Dictionary<int, ProcInfo> Processes() {
        var map = new Dictionary<int, ProcInfo>();
        IntPtr snap = CreateToolhelp32Snapshot(0x2, 0); // TH32CS_SNAPPROCESS
        if (snap == new IntPtr(-1)) return map;
        try {
            var entry = new ProcessEntry();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            for (bool ok = Process32First(snap, ref entry); ok; ok = Process32Next(snap, ref entry)) {
                var info = new ProcInfo();
                info.Name = entry.szExeFile;
                info.ParentId = (int)entry.th32ParentProcessID;
                map[(int)entry.th32ProcessID] = info;
            }
        } finally {
            CloseHandle(snap);
        }
        return map;
    }

    static string Title(IntPtr h) {
        var sb = new StringBuilder(512);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    // 보이는 최상위 창만(소유 창이 없고 제목이 있는 것)
    static List<IntPtr> TopWindows() {
        var list = new List<IntPtr>();
        EnumWindows((h, l) => {
            if (IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero && Title(h).Length > 0) list.Add(h); // GW_OWNER
            return true;
        }, IntPtr.Zero);
        return list;
    }

    static bool HasFolder(string title, string folder) {
        if (string.IsNullOrEmpty(folder)) return false;
        foreach (string p in title.Split(new[] { " - ", " – " }, StringSplitOptions.None)) {
            if (string.Equals(p.Trim(), folder, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    // VS Code 기본 창 제목: "[파일 - ]폴더 - Visual Studio Code"
    public static IntPtr FindVsCode(string folder) {
        foreach (IntPtr h in TopWindows()) {
            string t = Title(h);
            if (t.EndsWith(VsCodeSuffix) && HasFolder(t.Substring(0, t.Length - VsCodeSuffix.Length), folder)) return h;
        }
        return IntPtr.Zero;
    }

    // 그 프로세스가 가진 최상위 창. 여러 개면 제목에 폴더 이름이 든 창을 고른다.
    public static IntPtr FindByProcess(uint pid, string folder) {
        IntPtr first = IntPtr.Zero;
        foreach (IntPtr h in TopWindows()) {
            uint owner;
            GetWindowThreadProcessId(h, out owner);
            if (owner != pid) continue;
            if (HasFolder(Title(h), folder)) return h;
            if (first == IntPtr.Zero) first = h;
        }
        return first;
    }

    /** 결과: switch(Alt+Tab 방식으로 전환), attach(입력 스레드에 붙어 전환), blocked */
    public static string Focus(IntPtr hWnd) {
        if (IsIconic(hWnd)) ShowWindow(hWnd, 9); // SW_RESTORE
        // Alt+Tab과 같은 전환을 먼저 쓴다. 입력 상태를 붙이지 않아 커서 상태가 섞이지 않는다.
        SwitchToThisWindow(hWnd, true);
        string how = "switch";
        if (!WaitForeground(hWnd)) {
            AttachAndFocus(hWnd);
            how = "attach";
        }
        RefreshCursor();
        return GetForegroundWindow() == hWnd ? how : "blocked";
    }

    // 앞 창의 입력 스레드에 잠시 붙어 전환 권한을 얻는다(SwitchToThisWindow가 막혔을 때만).
    static void AttachAndFocus(IntPtr hWnd) {
        uint ignored;
        uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint me = GetCurrentThreadId();
        bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
        try {
            BringWindowToTop(hWnd);
            SetForegroundWindow(hWnd);
        } finally {
            if (attached) AttachThreadInput(me, fg, false);
        }
        WaitForeground(hWnd);
    }

    static bool WaitForeground(IntPtr hWnd) {
        for (int i = 0; i < 10; i++) {
            if (GetForegroundWindow() == hWnd) return true;
            Thread.Sleep(20);
        }
        return false;
    }

    // 프로그램으로 창을 바꾸면 커서 아래 창이 커서 모양을 다시 정하지 않아 '작업 중' 커서가 남을 수 있다.
    // Windows Terminal처럼 실제 마우스 입력에만 반응하는 창도 있어, 실제 입력으로 1만큼 움직였다가 되돌린다.
    static void RefreshCursor() {
        mouse_event(0x0001, 1, 0, 0, UIntPtr.Zero);  // MOUSEEVENTF_MOVE
        mouse_event(0x0001, -1, 0, 0, UIntPtr.Zero);
    }
}
