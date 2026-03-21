using Furion.Shapeless;

namespace TelegramMonitor;

[JobDetail("telegram-advertisement-job", Description = "telegram-advertisement-job", GroupName = "monitor", Concurrent = true)]
[PeriodMinutes(30, TriggerId = "telegram-ad-monitor-trigger", Description = "每30分钟执行一次的任务", RunOnStart = true)]
public class TelegramAdvertisementJob : IJob
{
    // 广告功能已移除：保留任务仅用于兼容现有调度扫描。
    private readonly ILogger<TelegramAdvertisementJob> _logger;

    public TelegramAdvertisementJob(ILogger<TelegramAdvertisementJob> logger)
    {
        _logger = logger;
    }

    public Task ExecuteAsync(JobExecutingContext context, CancellationToken stoppingToken)
    {
        _logger.LogDebug("广告功能已关闭，跳过广告任务执行");
        return Task.CompletedTask;
    }
}
