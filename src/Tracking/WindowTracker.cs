using System.Diagnostics;
using System.Runtime.InteropServices;

namespace DeviceUsageTracker.Tracking;

internal sealed class WindowTracker
{
    private readonly UsageLog _log = new();
    private readonly TimeSpan _interval;
    private readonly System.Windows.Forms.Timer _timer;

    public event EventHandler<UsageRecord>? RecordCaptured;

    public WindowTracker(TimeSpan? interval = null)
    {
        _interval = interval ?? TimeSpan.FromSeconds(1);
        _timer = new System.Windows.Forms.Timer
        {
            Interval = (int)_interval.TotalMilliseconds
        };
        _timer.Tick += (_, _) => Capture();
    }

    public void Start() => _timer.Start();

    public void Stop() => _timer.Stop();

    public void Capture()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
        {
            return;
        }

        var title = GetWindowTitle(hwnd);
        var processId = GetProcessId(hwnd);
        var processName = GetProcessName(processId);
        var (parentId, parentName) = GetParentProcessInfo(processId);

        var record = new UsageRecord
        {
            Timestamp = DateTime.UtcNow,
            WindowTitle = title,
            ProcessId = processId,
            ProcessName = processName,
            ParentProcessId = parentId,
            ParentProcessName = parentName
        };

        _log.Append(record);
        RecordCaptured?.Invoke(this, record);
    }

    private static int GetProcessId(IntPtr hwnd)
    {
        GetWindowThreadProcessId(hwnd, out var processId);
        return (int)processId;
    }

    private static string GetProcessName(int processId)
    {
        try
        {
            var process = Process.GetProcessById(processId);
            return process.ProcessName;
        }
        catch (Exception)
        {
            return "unknown";
        }
    }

    private static (int ParentId, string ParentName) GetParentProcessInfo(int processId)
    {
        try
        {
            using var searcher = new System.Management.ManagementObjectSearcher(
                "SELECT ParentProcessId FROM Win32_Process WHERE ProcessId=" + processId);
            foreach (var obj in searcher.Get())
            {
                var parentId = Convert.ToInt32(obj["ParentProcessId"]);
                return (parentId, GetProcessName(parentId));
            }
        }
        catch (Exception)
        {
            // ignore
        }

        return (0, "unknown");
    }

    private static string GetWindowTitle(IntPtr hwnd)
    {
        var length = GetWindowTextLength(hwnd);
        if (length == 0)
        {
            return string.Empty;
        }

        var builder = new System.Text.StringBuilder(length + 1);
        GetWindowText(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
