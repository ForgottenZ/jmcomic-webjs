using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;

namespace DeviceUsageTracker;

internal sealed class DataStore
{
    private readonly string _filePath;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public DataStore()
    {
        var baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceUsageTracker");
        Directory.CreateDirectory(baseDir);
        _filePath = Path.Combine(baseDir, "usage_log.jsonl");
    }

    public void Append(UsageRecord record)
    {
        var json = JsonSerializer.Serialize(record, JsonOptions);
        File.AppendAllLines(_filePath, new[] { json });
    }

    public IReadOnlyList<UsageRecord> ReadAll()
    {
        if (!File.Exists(_filePath))
        {
            return Array.Empty<UsageRecord>();
        }

        var records = new List<UsageRecord>();
        foreach (var line in File.ReadLines(_filePath))
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                var record = JsonSerializer.Deserialize<UsageRecord>(line, JsonOptions);
                if (record is not null)
                {
                    records.Add(record);
                }
            }
            catch
            {
                continue;
            }
        }

        return records;
    }

    public string FilePath => _filePath;
}
