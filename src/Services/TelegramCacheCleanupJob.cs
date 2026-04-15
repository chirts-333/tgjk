using Furion.Shapeless;

namespace TelegramMonitor;

[JobDetail("telegram-cache-cleanup-job", Description = "定期清理 Telegram 运行时缓存", GroupName = "monitor", Concurrent = false)]
[PeriodHours(2, TriggerId = "telegram-cache-cleanup-trigger", Description = "每两小时清理一次 Telegram 运行时缓存", RunOnStart = false)]
public sealed class TelegramCacheCleanupJob : IJob
{
    private readonly ILogger<TelegramCacheCleanupJob> _logger;
    private readonly TelegramClientManager _clientManager;

    public TelegramCacheCleanupJob(
        ILogger<TelegramCacheCleanupJob> logger,
        TelegramClientManager clientManager)
    {
        _logger = logger;
        _clientManager = clientManager;
    }

    public async Task ExecuteAsync(JobExecutingContext context, CancellationToken stoppingToken)
    {
        try
        {
            await _clientManager.CleanupCachesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "定时清理 Telegram 运行时缓存失败");
        }
    }
}
