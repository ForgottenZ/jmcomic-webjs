using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace DeviceUsageTracker;

internal static class Program
{
    private const string LoggerMutexName = "Global\\DeviceUsageTracker_Logger";
    private const string StopEventName = "Global\\DeviceUsageTracker_Stop";

    [STAThread]
    private static void Main(string[] args)
    {
        var parsed = CliOptions.Parse(args);

        if (parsed.ShowHelp)
        {
            Console.WriteLine(CliOptions.HelpText);
            return;
        }

        if (parsed.ExportOptions is not null)
        {
            RunExport(parsed.ExportOptions);
            return;
        }

        if (parsed.StatusOnly)
        {
            ReportStatus();
            return;
        }

        if (parsed.StopLogging)
        {
            SignalStop();
            return;
        }

        if (parsed.Silent)
        {
            RunSilent(parsed);
            return;
        }

        ApplicationConfiguration.Initialize();
        using var form = new MainForm(LoggerMutexName, StopEventName);
        Application.Run(form);
    }

    private static void RunSilent(CliOptions options)
    {
        using var mutex = new Mutex(true, LoggerMutexName, out var createdNew);
        if (!createdNew)
        {
            Console.WriteLine("Logging is already running.");
            return;
        }

        using var stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, StopEventName);
        using var logger = new LoggerService(stopEvent);
        logger.Start();

        if (options.Notify)
        {
            MessageBox.Show("已在后台启动记录。", "DeviceUsageTracker", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        stopEvent.WaitOne();
    }

    private static void RunExport(ExportOptions options)
    {
        var store = new DataStore();
        var records = store.ReadAll();
        var exporter = new Exporter();
        var items = exporter.Aggregate(records, options);
        exporter.WriteCsv(items, options.OutputPath);
        Console.WriteLine($"Exported {items.Count} rows to {options.OutputPath}.");
    }

    private static void ReportStatus()
    {
        var running = Mutex.TryOpenExisting(LoggerMutexName, out _);
        Console.WriteLine(running ? "Logging is running." : "Logging is not running.");
    }

    private static void SignalStop()
    {
        if (EventWaitHandle.TryOpenExisting(StopEventName, out var stopEvent))
        {
            stopEvent.Set();
            Console.WriteLine("Stop signal sent.");
            return;
        }

        Console.WriteLine("No running logger found.");
    }
}

internal sealed class CliOptions
{
    public bool Silent { get; init; }
    public bool Notify { get; init; } = true;
    public bool StatusOnly { get; init; }
    public bool StopLogging { get; init; }
    public bool ShowHelp { get; init; }
    public ExportOptions? ExportOptions { get; init; }

    public static string HelpText => string.Join(Environment.NewLine, new[]
    {
        "DeviceUsageTracker (Windows only)",
        "", 
        "Usage:",
        "  DeviceUsageTracker.exe                Launch UI",
        "  DeviceUsageTracker.exe --silent       Start logging in background",
        "  DeviceUsageTracker.exe --silent --no-notify",
        "  DeviceUsageTracker.exe --status       Show logging status",
        "  DeviceUsageTracker.exe --stop         Stop background logging",
        "  DeviceUsageTracker.exe --export --range 7d --sort desc --out usage.csv",
        "", 
        "Range format: <number><unit> (unit: h=hours, d=days, m=months)",
        "Sort: asc or desc (by total seconds)",
    });

    public static CliOptions Parse(string[] args)
    {
        if (args.Length == 0)
        {
            return new CliOptions();
        }

        var silent = args.Contains("--silent", StringComparer.OrdinalIgnoreCase);
        var notify = !args.Contains("--no-notify", StringComparer.OrdinalIgnoreCase);
        var status = args.Contains("--status", StringComparer.OrdinalIgnoreCase);
        var stop = args.Contains("--stop", StringComparer.OrdinalIgnoreCase);
        var help = args.Contains("--help", StringComparer.OrdinalIgnoreCase) || args.Contains("-h");

        ExportOptions? export = null;
        if (args.Contains("--export", StringComparer.OrdinalIgnoreCase))
        {
            var rangeValue = GetValue(args, "--range") ?? "7d";
            var sortValue = GetValue(args, "--sort") ?? "desc";
            var outValue = GetValue(args, "--out") ?? Path.Combine(Environment.CurrentDirectory, "usage.csv");
            export = ExportOptions.From(rangeValue, sortValue, outValue);
        }

        return new CliOptions
        {
            Silent = silent,
            Notify = notify,
            StatusOnly = status,
            StopLogging = stop,
            ShowHelp = help,
            ExportOptions = export
        };
    }

    private static string? GetValue(string[] args, string key)
    {
        var index = Array.FindIndex(args, a => string.Equals(a, key, StringComparison.OrdinalIgnoreCase));
        if (index < 0 || index + 1 >= args.Length)
        {
            return null;
        }

        return args[index + 1];
    }
}

internal sealed class ExportOptions
{
    public DateTime FromUtc { get; init; }
    public DateTime ToUtc { get; init; } = DateTime.UtcNow;
    public SortOrder SortOrder { get; init; } = SortOrder.Descending;
    public string OutputPath { get; init; } = "usage.csv";

    public static ExportOptions From(string range, string sort, string output)
    {
        var now = DateTime.UtcNow;
        var span = range.Trim();
        if (span.Length < 2)
        {
            throw new ArgumentException("Range must include a number and unit.");
        }

        var unit = span[^1];
        if (!int.TryParse(span[..^1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
        {
            throw new ArgumentException("Range number is invalid.");
        }

        DateTime fromUtc = unit switch
        {
            'h' or 'H' => now.AddHours(-value),
            'd' or 'D' => now.AddDays(-value),
            'm' or 'M' => now.AddMonths(-value),
            _ => throw new ArgumentException("Range unit must be h, d, or m.")
        };

        var order = sort.Equals("asc", StringComparison.OrdinalIgnoreCase)
            ? SortOrder.Ascending
            : SortOrder.Descending;

        return new ExportOptions
        {
            FromUtc = fromUtc,
            SortOrder = order,
            OutputPath = output
        };
    }
}

internal enum SortOrder
{
    Ascending,
    Descending
}
