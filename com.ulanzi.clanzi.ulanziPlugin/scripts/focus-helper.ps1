# clanzi 창 전환 도우미. 플러그인이 한 번 띄워 두고 표준 입력으로 한 줄짜리 JSON 요청을 보낸다.
#   {"op":"vscode","folder":"clanzi","session":"<id>"}  VS Code 창을 폴더 이름으로 찾아 앞으로 가져온 뒤 그 대화를 연다
#   {"op":"pid","pid":1234,"folder":"clanzi"}           프로세스의 부모를 따라 올라가 창을 가진 앱을 앞으로 가져온다
#   {"op":"kill","pid":1234}                            claude 프로세스일 때만 하위 프로세스까지 강제 종료한다
#   {"op":"url","url":"https://..."}                    기본 브라우저로 연다
# 응답은 한 줄: focused:switch | focused:attach | opened | not-found | blocked | error:<메시지>
# Windows는 백그라운드 프로세스의 창 전환을 막으므로, 현재 앞 창의 입력 스레드에 잠시 붙어서 전환 권한을 얻는다.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ClanziWindow {
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

    const string VsCodeSuffix = " - Visual Studio Code";

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
            System.Threading.Thread.Sleep(20);
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
'@

function Focus-Result([IntPtr]$hwnd) {
    if ($hwnd -eq [IntPtr]::Zero) { return 'not-found' }
    $how = [ClanziWindow]::Focus($hwnd)
    if ($how -eq 'blocked') { return 'blocked' }
    return "focused:$how"
}

# 부모 프로세스를 따라 올라가며 창을 가진 첫 프로세스를 찾는다.
# 탐색기(explorer.exe)까지 올라왔다면 터미널 앱을 지나친 것이므로 멈춘다(바탕화면·탐색기 창을 띄우지 않게).
function Find-AncestorWindow([int]$procId, [string]$folder) {
    $seen = @{}
    while ($procId -gt 0 -and -not $seen.ContainsKey($procId)) {
        $seen[$procId] = $true
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if (-not $proc -or $proc.Name -ieq 'explorer.exe') { break }
        $hwnd = [ClanziWindow]::FindByProcess([uint32]$procId, $folder)
        if ($hwnd -ne [IntPtr]::Zero) { return $hwnd }
        $procId = [int]$proc.ParentProcessId
    }
    return [IntPtr]::Zero
}

[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
        $req = $line | ConvertFrom-Json
        switch ($req.op) {
            'vscode' {
                $result = Focus-Result ([ClanziWindow]::FindVsCode([string]$req.folder))
                # 창을 못 찾았어도 URI는 연다. VS Code가 마지막으로 쓴 창에서 대화를 연다.
                if ($req.session -match '^[0-9a-fA-F-]{36}$') {
                    Start-Process "vscode://anthropic.claude-code/open?session=$($req.session)"
                    if ($result -eq 'not-found') { $result = 'opened' }
                }
            }
            'pid' { $result = Focus-Result (Find-AncestorWindow ([int]$req.pid) ([string]$req.folder)) }
            'url' {
                # 기본 브라우저로 연다. https 주소만 받는다.
                $url = [string]$req.url
                if ($url -match '^https://[^\s"]+$') { Start-Process $url; $result = 'opened' } else { $result = 'error:bad url' }
            }
            'kill' {
                # 세션이 끝난 뒤 같은 PID를 다른 프로그램이 받았을 수 있으니 claude 프로세스일 때만 끈다.
                $target = Get-Process -Id ([int]$req.pid) -ErrorAction SilentlyContinue
                if (-not $target) { $result = 'not-found' }
                elseif ($target.ProcessName -ne 'claude') { $result = 'not-claude:' + $target.ProcessName }
                else {
                    & taskkill.exe /PID $target.Id /T /F | Out-Null
                    $result = if ($LASTEXITCODE -eq 0) { 'killed' } else { "error:taskkill $LASTEXITCODE" }
                }
            }
            default { $result = 'error:unknown op' }
        }
    } catch {
        $result = 'error:' + ($_.Exception.Message -replace '\s+', ' ')
    }
    [Console]::Out.WriteLine($result)
}
