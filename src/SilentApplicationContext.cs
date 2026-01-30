using DeviceUsageTracker.Tracking;

namespace DeviceUsageTracker;

internal sealed class SilentApplicationContext : ApplicationContext
{
    private readonly WindowTracker _tracker;

    public SilentApplicationContext(bool consoleOutput)
    {
        _tracker = new WindowTracker();
        if (consoleOutput)
        {
            _tracker.RecordCaptured += (_, record) =>
            {
                Console.WriteLine($"{record.Timestamp:O} | {record.ProcessName} | {record.WindowTitle}");
            };
        }

        _tracker.Start();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tracker.Stop();
        }

        base.Dispose(disposing);
    }
}
