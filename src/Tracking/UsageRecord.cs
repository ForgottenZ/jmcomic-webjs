namespace DeviceUsageTracker.Tracking;

internal sealed class UsageRecord
{
    public DateTime Timestamp { get; set; }
    public string WindowTitle { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public int ProcessId { get; set; }
    public string ParentProcessName { get; set; } = string.Empty;
    public int ParentProcessId { get; set; }
}
