using System;
using System.IO;
using System.Windows.Forms;

namespace DeviceUsageTracker;

internal sealed class MainForm : Form
{
    private readonly string _mutexName;
    private readonly string _stopEventName;
    private readonly Label _statusLabel;
    private readonly Button _startButton;
    private readonly Button _stopButton;
    private readonly Button _exportButton;
    private readonly TextBox _rangeText;
    private readonly ComboBox _sortCombo;
    private readonly DataStore _store;

    private Mutex? _loggerMutex;
    private LoggerService? _logger;
    private EventWaitHandle? _stopEvent;

    public MainForm(string mutexName, string stopEventName)
    {
        _mutexName = mutexName;
        _stopEventName = stopEventName;
        _store = new DataStore();

        Text = "DeviceUsageTracker";
        Width = 520;
        Height = 260;
        StartPosition = FormStartPosition.CenterScreen;

        _statusLabel = new Label
        {
            Text = "状态: 未启动",
            AutoSize = true,
            Top = 20,
            Left = 20
        };

        _startButton = new Button
        {
            Text = "开始记录",
            Top = 60,
            Left = 20,
            Width = 100
        };
        _startButton.Click += StartClicked;

        _stopButton = new Button
        {
            Text = "停止记录",
            Top = 60,
            Left = 140,
            Width = 100
        };
        _stopButton.Click += StopClicked;

        _exportButton = new Button
        {
            Text = "导出",
            Top = 140,
            Left = 20,
            Width = 100
        };
        _exportButton.Click += ExportClicked;

        _rangeText = new TextBox
        {
            Top = 105,
            Left = 20,
            Width = 100,
            Text = "7d"
        };

        _sortCombo = new ComboBox
        {
            Top = 105,
            Left = 140,
            Width = 100,
            DropDownStyle = ComboBoxStyle.DropDownList
        };
        _sortCombo.Items.AddRange(new object[] { "desc", "asc" });
        _sortCombo.SelectedIndex = 0;

        Controls.AddRange(new Control[]
        {
            _statusLabel,
            _startButton,
            _stopButton,
            _exportButton,
            _rangeText,
            _sortCombo
        });

        FormClosed += (_, _) => Cleanup();
        Load += (_, _) => RefreshStatus();
    }

    private void StartClicked(object? sender, EventArgs e)
    {
        _loggerMutex = new Mutex(true, _mutexName, out var createdNew);
        if (!createdNew)
        {
            MessageBox.Show("已有后台记录在运行，不能再次启动记录。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            _loggerMutex.Dispose();
            _loggerMutex = null;
            RefreshStatus();
            return;
        }

        _stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, _stopEventName);
        _logger = new LoggerService(_stopEvent);
        _logger.Start();
        _statusLabel.Text = "状态: 记录中";
        _startButton.Enabled = false;
        _stopButton.Enabled = true;
    }

    private void StopClicked(object? sender, EventArgs e)
    {
        if (_stopEvent is not null)
        {
            _stopEvent.Set();
        }

        _logger?.Dispose();
        _logger = null;
        _loggerMutex?.Dispose();
        _loggerMutex = null;
        _statusLabel.Text = "状态: 已停止";
        _startButton.Enabled = true;
        _stopButton.Enabled = false;
    }

    private void ExportClicked(object? sender, EventArgs e)
    {
        try
        {
            var range = _rangeText.Text.Trim();
            var sort = _sortCombo.SelectedItem?.ToString() ?? "desc";
            var options = ExportOptions.From(range, sort, Path.Combine(Environment.CurrentDirectory, "usage.csv"));
            var exporter = new Exporter();
            var summaries = exporter.Aggregate(_store.ReadAll(), options);
            exporter.WriteCsv(summaries, options.OutputPath);
            MessageBox.Show($"已导出 {summaries.Count} 条记录到 {options.OutputPath}", "导出完成");
        }
        catch (Exception ex)
        {
            MessageBox.Show($"导出失败: {ex.Message}", "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void RefreshStatus()
    {
        var running = Mutex.TryOpenExisting(_mutexName, out _);
        if (running)
        {
            _statusLabel.Text = "状态: 后台记录中";
            _startButton.Enabled = false;
            _stopButton.Enabled = false;
        }
        else
        {
            _statusLabel.Text = "状态: 未启动";
            _startButton.Enabled = true;
            _stopButton.Enabled = false;
        }
    }

    private void Cleanup()
    {
        _logger?.Dispose();
        _logger = null;
        _loggerMutex?.Dispose();
        _loggerMutex = null;
        _stopEvent?.Dispose();
        _stopEvent = null;
    }
}
