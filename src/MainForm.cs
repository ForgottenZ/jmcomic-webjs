using DeviceUsageTracker.Tracking;

namespace DeviceUsageTracker;

internal sealed class MainForm : Form
{
    private readonly bool _recordingAlreadyRunning;
    private readonly WindowTracker _tracker;
    private readonly TextBox _rangeTextBox;
    private readonly ComboBox _sortComboBox;
    private readonly TextBox _outputTextBox;
    private readonly Label _statusLabel;
    private readonly Button _startButton;
    private readonly Button _stopButton;
    private readonly bool _consoleOutput;

    public MainForm(bool recordingAlreadyRunning, bool consoleOutput)
    {
        _recordingAlreadyRunning = recordingAlreadyRunning;
        _consoleOutput = consoleOutput;
        _tracker = new WindowTracker();
        _tracker.RecordCaptured += OnRecordCaptured;

        Text = "设备使用时间检测";
        Width = 680;
        Height = 380;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 7,
            Padding = new Padding(12),
            AutoSize = true
        };

        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        _statusLabel = new Label
        {
            Text = recordingAlreadyRunning
                ? "检测到已有静默记录进程，已禁用本地记录。"
                : "准备就绪。",
            AutoSize = true,
            Dock = DockStyle.Fill
        };

        _startButton = new Button
        {
            Text = "开始记录",
            Dock = DockStyle.Fill,
            Enabled = !recordingAlreadyRunning
        };
        _startButton.Click += (_, _) => StartTracking();

        _stopButton = new Button
        {
            Text = "停止记录",
            Dock = DockStyle.Fill,
            Enabled = false
        };
        _stopButton.Click += (_, _) => StopTracking();

        _rangeTextBox = new TextBox
        {
            Text = "7d",
            Dock = DockStyle.Fill
        };

        _sortComboBox = new ComboBox
        {
            Dock = DockStyle.Fill,
            DropDownStyle = ComboBoxStyle.DropDownList
        };
        _sortComboBox.Items.AddRange(new[] { "desc", "asc" });
        _sortComboBox.SelectedIndex = 0;

        _outputTextBox = new TextBox
        {
            Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "device_usage_export.csv"),
            Dock = DockStyle.Fill
        };

        var exportButton = new Button
        {
            Text = "导出统计",
            Dock = DockStyle.Fill
        };
        exportButton.Click += (_, _) => ExportData();

        layout.Controls.Add(new Label { Text = "状态", Dock = DockStyle.Fill }, 0, 0);
        layout.Controls.Add(_statusLabel, 1, 0);
        layout.Controls.Add(new Label { Text = "记录", Dock = DockStyle.Fill }, 0, 1);
        layout.Controls.Add(CreateButtonRow(), 1, 1);
        layout.Controls.Add(new Label { Text = "导出范围", Dock = DockStyle.Fill }, 0, 2);
        layout.Controls.Add(_rangeTextBox, 1, 2);
        layout.Controls.Add(new Label { Text = "排序", Dock = DockStyle.Fill }, 0, 3);
        layout.Controls.Add(_sortComboBox, 1, 3);
        layout.Controls.Add(new Label { Text = "输出路径", Dock = DockStyle.Fill }, 0, 4);
        layout.Controls.Add(_outputTextBox, 1, 4);
        layout.Controls.Add(new Label(), 0, 5);
        layout.Controls.Add(exportButton, 1, 5);

        Controls.Add(layout);
    }

    private Control CreateButtonRow()
    {
        var panel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            AutoSize = true
        };
        panel.Controls.Add(_startButton);
        panel.Controls.Add(_stopButton);
        return panel;
    }

    private void StartTracking()
    {
        if (_recordingAlreadyRunning)
        {
            MessageBox.Show("已有静默记录进程在运行，无法重复启动记录。", "设备使用时间检测", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        _tracker.Start();
        _startButton.Enabled = false;
        _stopButton.Enabled = true;
        _statusLabel.Text = "正在记录中...";
    }

    private void StopTracking()
    {
        _tracker.Stop();
        _startButton.Enabled = true;
        _stopButton.Enabled = false;
        _statusLabel.Text = "已停止记录。";
    }

    private void ExportData()
    {
        var exportWindow = CommandLineOptions.Parse(new[] { "--export-range", _rangeTextBox.Text }).ExportWindow
            ?? new TimeWindow(7, TimeUnit.Days);

        var sortOrder = _sortComboBox.SelectedItem?.ToString() == "asc"
            ? SortOrder.Ascending
            : SortOrder.Descending;

        var outputPath = _outputTextBox.Text;

        var exportService = new ExportService();
        var result = exportService.Export(UsageLog.DefaultLogPath, exportWindow, sortOrder, outputPath);

        var message = $"已导出 {result.ExportCount} 条记录到:\n{result.OutputPath}";
        _statusLabel.Text = "导出完成。";

        if (_consoleOutput)
        {
            Console.WriteLine(message);
        }
        else
        {
            MessageBox.Show(message, "设备使用时间检测", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private void OnRecordCaptured(object? sender, UsageRecord record)
    {
        if (_consoleOutput)
        {
            Console.WriteLine($"{record.Timestamp:O} | {record.ProcessName} | {record.WindowTitle}");
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        _tracker.Stop();
        base.OnFormClosing(e);
    }
}
