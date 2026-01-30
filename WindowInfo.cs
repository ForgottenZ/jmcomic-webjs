using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Management;

namespace DeviceUsageTracker;

internal readonly struct WindowInfo
{
    public WindowInfo(int processId, string processName, int parentProcessId, string parentProcessName, string windowTitle)
    {
        ProcessId = processId;
        ProcessName = processName;
        ParentProcessId = parentProcessId;
        ParentProcessName = parentProcessName;
        WindowTitle = windowTitle;
    }

    public int ProcessId { get; }
    public string ProcessName { get; }
    public int ParentProcessId { get; }
    public string ParentProcessName { get; }
    public string WindowTitle { get; }

    public static WindowInfo? CaptureActiveWindow()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
        {
            return null;
        }

        _ = GetWindowThreadProcessId(hwnd, out var processId);
        if (processId == 0)
        {
            return null;
        }

        string title = GetWindowTitle(hwnd);
        var processName = "unknown";
        var parentId = 0;
        var parentName = "unknown";

        try
        {
            using var process = Process.GetProcessById((int)processId);
            processName = process.ProcessName;
            parentId = GetParentProcessId(process.Id);
            if (parentId > 0)
            {
                using var parent = Process.GetProcessById(parentId);
                parentName = parent.ProcessName;
            }
        }
        catch
        {
            processName = "unknown";
        }

        return new WindowInfo((int)processId, processName, parentId, parentName, title);
    }

    private static string GetWindowTitle(IntPtr hwnd)
    {
        var length = GetWindowTextLength(hwnd);
        if (length <= 0)
        {
            return string.Empty;
        }

        var builder = new StringBuilder(length + 1);
        _ = GetWindowText(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    private static int GetParentProcessId(int processId)
    {
        using var query = new ManagementObjectSearcher($"SELECT ParentProcessId FROM Win32_Process WHERE ProcessId = {processId}");
        foreach (var obj in query.Get())
        {
            return Convert.ToInt32(obj["ParentProcessId"]);
        }

        return 0;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
