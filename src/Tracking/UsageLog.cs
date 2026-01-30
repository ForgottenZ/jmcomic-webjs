using System.Text.Json;

namespace DeviceUsageTracker.Tracking;

internal sealed class UsageLog
{
    public static readonly string DefaultLogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DeviceUsageTracker",
        "usage_log.jsonl");

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = false
    };

    public void Append(UsageRecord record)
    {
        var directory = Path.GetDirectoryName(DefaultLogPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var json = JsonSerializer.Serialize(record, SerializerOptions);
        File.AppendAllText(DefaultLogPath, json + Environment.NewLine);
    }

    public IEnumerable<UsageRecord> ReadAll()
    {
        if (!File.Exists(DefaultLogPath))
        {
            return Array.Empty<UsageRecord>();
        }

        var records = new List<UsageRecord>();
        foreach (var line in File.ReadLines(DefaultLogPath))
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var record = JsonSerializer.Deserialize<UsageRecord>(line, SerializerOptions);
                if (record != null)
                {
                    records.Add(record);
                }
            }
            catch (JsonException)
            {
                // Ignore malformed lines.
            }
        }

        return records;
    }
}
