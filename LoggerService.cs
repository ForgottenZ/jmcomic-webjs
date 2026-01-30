using System;
using System.Collections.Generic;
using System.Threading;

namespace DeviceUsageTracker;

internal sealed class LoggerService : IDisposable
{
    private readonly EventWaitHandle _stopEvent;
    private readonly Timer _timer;
    private readonly DataStore _store;
    private bool _running;

    public LoggerService(EventWaitHandle stopEvent)
    {
        _stopEvent = stopEvent;
        _store = new DataStore();
        _timer = new Timer(LogActiveWindow, null, Timeout.Infinite, Timeout.Infinite);
    }

    public void Start()
    {
        if (_running)
        {
            return;
        }

        _running = true;
        _timer.Change(TimeSpan.Zero, TimeSpan.FromSeconds(5));
    }

    public void Stop()
    {
        if (!_running)
        {
            return;
        }

        _running = false;
        _timer.Change(Timeout.Infinite, Timeout.Infinite);
    }

    public void Dispose()
    {
        Stop();
        _timer.Dispose();
    }

    private void LogActiveWindow(object? state)
    {
        if (!_running || _stopEvent.WaitOne(0))
        {
            Stop();
            return;
        }

        var info = WindowInfo.CaptureActiveWindow();
        if (info is null)
        {
            return;
        }

        var record = UsageRecord.From(info.Value);
        _store.Append(record);
    }
}

internal sealed record UsageRecord(
    DateTime TimestampUtc,
    int ProcessId,
    string ProcessName,
    int ParentProcessId,
    string ParentProcessName,
    string WindowTitle)
{
    public static UsageRecord From(WindowInfo info)
    {
        return new UsageRecord(
            DateTime.UtcNow,
            info.ProcessId,
            info.ProcessName,
            info.ParentProcessId,
            info.ParentProcessName,
            info.WindowTitle);
    }
}
