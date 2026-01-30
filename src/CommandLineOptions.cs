using System.Globalization;
using DeviceUsageTracker.Tracking;

namespace DeviceUsageTracker;

internal sealed class CommandLineOptions
{
    public bool Silent { get; private set; }
    public bool NotifyOnSilentStart { get; private set; }
    public bool ConsoleOutput { get; private set; }
    public bool ExportRequested { get; private set; }
    public bool ShowHelp { get; private set; }
    public TimeWindow? ExportWindow { get; private set; }
    public SortOrder? ExportSortOrder { get; private set; }
    public string? ExportOutputPath { get; private set; }

    public static CommandLineOptions Parse(string[] args)
    {
        var options = new CommandLineOptions();

        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i].Trim();

            switch (arg.ToLowerInvariant())
            {
                case "-h":
                case "--help":
                    options.ShowHelp = true;
                    return options;
                case "--silent":
                    options.Silent = true;
                    break;
                case "--notify":
                    options.NotifyOnSilentStart = true;
                    break;
                case "--console":
                    options.ConsoleOutput = true;
                    break;
                case "--export":
                    options.ExportRequested = true;
                    break;
                case "--export-range":
                    if (i + 1 >= args.Length)
                    {
                        options.ShowHelp = true;
                        return options;
                    }
                    options.ExportWindow = ParseTimeWindow(args[++i]);
                    break;
                case "--export-sort":
                    if (i + 1 >= args.Length)
                    {
                        options.ShowHelp = true;
                        return options;
                    }
                    options.ExportSortOrder = ParseSortOrder(args[++i]);
                    break;
                case "--export-output":
                    if (i + 1 >= args.Length)
                    {
                        options.ShowHelp = true;
                        return options;
                    }
                    options.ExportOutputPath = args[++i];
                    break;
                default:
                    options.ShowHelp = true;
                    return options;
            }
        }

        return options;
    }

    public static string GetUsage()
    {
        return string.Join(Environment.NewLine, new[]
        {
            "设备使用时间检测程序 (Windows)",
            "",            
            "用法:",
            "  DeviceUsageTracker.exe [参数]",
            "",            
            "参数:",
            "  --silent           静默启动(无UI)",
            "  --notify           静默启动时弹窗提示",
            "  --console          输出控制台日志",
            "  --export           导出统计数据",
            "  --export-range N[u] 例如 7d, 12h, 2m (天/小时/月)",
            "  --export-sort asc|desc 导出排序(升序或降序)",
            "  --export-output PATH 导出文件路径",
            "  --help             显示帮助"
        });
    }

    private static TimeWindow ParseTimeWindow(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return new TimeWindow(7, TimeUnit.Days);
        }

        var unitChar = value[^1];
        if (!int.TryParse(value[..^1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var amount))
        {
            return new TimeWindow(7, TimeUnit.Days);
        }

        var unit = unitChar switch
        {
            'h' or 'H' => TimeUnit.Hours,
            'd' or 'D' => TimeUnit.Days,
            'm' or 'M' => TimeUnit.Months,
            _ => TimeUnit.Days
        };

        return new TimeWindow(amount, unit);
    }

    private static SortOrder ParseSortOrder(string value)
    {
        return value.Equals("asc", StringComparison.OrdinalIgnoreCase)
            ? SortOrder.Ascending
            : SortOrder.Descending;
    }
}
