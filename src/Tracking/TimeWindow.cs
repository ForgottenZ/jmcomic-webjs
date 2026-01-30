namespace DeviceUsageTracker.Tracking;

internal enum TimeUnit
{
    Hours,
    Days,
    Months
}

internal readonly struct TimeWindow
{
    public TimeWindow(int amount, TimeUnit unit)
    {
        Amount = Math.Max(1, amount);
        Unit = unit;
    }

    public int Amount { get; }
    public TimeUnit Unit { get; }

    public DateTime GetStart(DateTime nowUtc)
    {
        return Unit switch
        {
            TimeUnit.Hours => nowUtc.AddHours(-Amount),
            TimeUnit.Days => nowUtc.AddDays(-Amount),
            TimeUnit.Months => nowUtc.AddMonths(-Amount),
            _ => nowUtc.AddDays(-Amount)
        };
    }
}

internal enum SortOrder
{
    Ascending,
    Descending
}
