using System.Globalization;
using DeviceUsageTracker.Tracking;

namespace DeviceUsageTracker;

internal static class Program
{
    private const string RecorderMutexName = "Global\\DeviceUsageTrackerRecorder";

    [STAThread]
    private static void Main(string[] args)
    {
        var options = CommandLineOptions.Parse(args);

        if (options.ShowHelp)
        {
            Console.WriteLine(CommandLineOptions.GetUsage());
            return;
        }

        if (options.ExportRequested)
        {
            RunExport(options);
            return;
        }

        ApplicationConfiguration.Initialize();

        if (options.Silent)
        {
            RunSilent(options);
            return;
        }

        RunUi(options);
    }

    private static void RunSilent(CommandLineOptions options)
    {
        using var mutex = new Mutex(true, RecorderMutexName, out var createdNew);
        if (!createdNew)
        {
            if (options.NotifyOnSilentStart)
            {
                MessageBox.Show("记录程序已在运行。", "设备使用时间检测", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return;
        }

        if (options.NotifyOnSilentStart)
        {
            MessageBox.Show("记录程序已以静默模式启动。", "设备使用时间检测", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        var context = new SilentApplicationContext(options.ConsoleOutput);
        Application.Run(context);
    }

    private static void RunUi(CommandLineOptions options)
    {
        var isRecordingAlready = Mutex.TryOpenExisting(RecorderMutexName, out _);
        var form = new MainForm(isRecordingAlready, options.ConsoleOutput);
        Application.Run(form);
    }

    private static void RunExport(CommandLineOptions options)
    {
        var exportWindow = options.ExportWindow ?? new TimeWindow(7, TimeUnit.Days);
        var sortOrder = options.ExportSortOrder ?? SortOrder.Descending;
        var outputPath = options.ExportOutputPath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "device_usage_export.csv");

        var exportService = new ExportService();
        var results = exportService.Export(
            UsageLog.DefaultLogPath,
            exportWindow,
            sortOrder,
            outputPath);

        if (options.ConsoleOutput)
        {
            Console.WriteLine($"已导出 {results.ExportCount} 条记录到: {results.OutputPath}");
        }
        else
        {
            MessageBox.Show($"已导出 {results.ExportCount} 条记录到:\n{results.OutputPath}", "设备使用时间检测", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}
