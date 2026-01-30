using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace DeviceUsageTracker;

internal sealed class Exporter
{
    public List<UsageSummary> Aggregate(IReadOnlyList<UsageRecord> records, ExportOptions options)
    {
        var filtered = records
            .Where(r => r.TimestampUtc >= options.FromUtc && r.TimestampUtc <= options.ToUtc)
            .OrderBy(r => r.TimestampUtc)
            .ToList();

        var totals = new Dictionary<string, UsageSummary>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < filtered.Count; i++)
        {
            var current = filtered[i];
            var nextTimestamp = i + 1 < filtered.Count ? filtered[i + 1].TimestampUtc : current.TimestampUtc.AddSeconds(5);
            var duration = Math.Max(0, (nextTimestamp - current.TimestampUtc).TotalSeconds);
            var key = BuildKey(current);

            if (!totals.TryGetValue(key, out var summary))
            {
                summary = new UsageSummary(current.ProcessName, current.ParentProcessName, current.WindowTitle, 0);
                totals[key] = summary;
            }

            summary.TotalSeconds += duration;
        }

        var list = totals.Values.ToList();
        list = options.SortOrder == SortOrder.Ascending
            ? list.OrderBy(s => s.TotalSeconds).ToList()
            : list.OrderByDescending(s => s.TotalSeconds).ToList();

        return list;
    }

    public void WriteCsv(IReadOnlyList<UsageSummary> items, string path)
    {
        var lines = new List<string>
        {
            "Process,ParentProcess,WindowTitle,TotalSeconds"
        };

        lines.AddRange(items.Select(item =>
            string.Join(',', Escape(item.ProcessName), Escape(item.ParentProcessName), Escape(item.WindowTitle),
                item.TotalSeconds.ToString(CultureInfo.InvariantCulture))));

        File.WriteAllLines(path, lines);
    }

    private static string Escape(string value)
    {
        if (value.Contains('"') || value.Contains(',') || value.Contains('\n'))
        {
            return '"' + value.Replace("\"", "\"\"") + '"';
        }

        return value;
    }

    private static string BuildKey(UsageRecord record)
    {
        return string.Join("|", record.ProcessName, record.ParentProcessName, record.WindowTitle);
    }
}

internal sealed class UsageSummary
{
    public UsageSummary(string processName, string parentProcessName, string windowTitle, double totalSeconds)
    {
        ProcessName = processName;
        ParentProcessName = parentProcessName;
        WindowTitle = windowTitle;
        TotalSeconds = totalSeconds;
    }

    public string ProcessName { get; }
    public string ParentProcessName { get; }
    public string WindowTitle { get; }
    public double TotalSeconds { get; set; }
}
