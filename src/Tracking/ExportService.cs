using System.Globalization;

namespace DeviceUsageTracker.Tracking;

internal sealed class ExportService
{
    private const int SampleIntervalSeconds = 1;

    public ExportResult Export(string logPath, TimeWindow window, SortOrder sortOrder, string outputPath)
    {
        var log = new UsageLog();
        var records = log.ReadAll();

        var nowUtc = DateTime.UtcNow;
        var start = window.GetStart(nowUtc);

        var filtered = records.Where(r => r.Timestamp >= start && r.Timestamp <= nowUtc);

        var grouped = filtered
            .GroupBy(r => new UsageKey(r.WindowTitle, r.ProcessName, r.ParentProcessName))
            .Select(group => new UsageSummary
            {
                WindowTitle = group.Key.WindowTitle,
                ProcessName = group.Key.ProcessName,
                ParentProcessName = group.Key.ParentProcessName,
                TotalSeconds = group.Count() * SampleIntervalSeconds
            });

        var ordered = sortOrder == SortOrder.Ascending
            ? grouped.OrderBy(summary => summary.TotalSeconds)
            : grouped.OrderByDescending(summary => summary.TotalSeconds);

        var lines = new List<string>
        {
            "WindowTitle,ProcessName,ParentProcessName,TotalSeconds"
        };

        foreach (var item in ordered)
        {
            lines.Add(string.Join(",", new[]
            {
                Escape(item.WindowTitle),
                Escape(item.ProcessName),
                Escape(item.ParentProcessName),
                item.TotalSeconds.ToString(CultureInfo.InvariantCulture)
            }));
        }

        var directory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllLines(outputPath, lines);

        return new ExportResult(lines.Count - 1, outputPath);
    }

    private static string Escape(string value)
    {
        if (value.Contains(',') || value.Contains('"'))
        {
            return '"' + value.Replace("\"", "\"\"") + '"';
        }

        return value;
    }
}

internal readonly record struct UsageKey(string WindowTitle, string ProcessName, string ParentProcessName);

internal sealed class UsageSummary
{
    public string WindowTitle { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public string ParentProcessName { get; set; } = string.Empty;
    public int TotalSeconds { get; set; }
}

internal readonly record struct ExportResult(int ExportCount, string OutputPath);
