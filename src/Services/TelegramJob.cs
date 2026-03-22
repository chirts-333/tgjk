using Furion.Shapeless;

namespace TelegramMonitor;

[JobDetail("telegram-job", Description = "Telegram账号活跃检查", GroupName = "monitor", Concurrent = true)]
[PeriodSeconds(60, TriggerId = "telegram-trigger", Description = "每分钟检查一次账号活跃度", RunOnStart = false)]
public sealed class TelegramJob : IJob
{
    private readonly ILogger<TelegramJob> _logger;
    private readonly TelegramClientManager _clientManager;

    public TelegramJob(ILogger<TelegramJob> logger, TelegramClientManager clientManager)
    {
        _logger = logger;
        _clientManager = clientManager;
    }

    public async Task ExecuteAsync(JobExecutingContext context, CancellationToken stoppingToken)
    {
        try
        {
            var runtimes = await _clientManager.GetRuntimeSummariesAsync();
            foreach (var runtime in runtimes)
            {
                if (runtime.LoggedIn || string.IsNullOrWhiteSpace(runtime.PhoneNumber))
                    continue;

                _logger.LogWarning("用户 {UserId} 的 Telegram 账号已断开，尝试重连", runtime.UserId);
                var loginResult = await _clientManager.ConnectAsync(runtime.UserId, runtime.PhoneNumber);

                if (loginResult == LoginState.LoggedIn)
                {
                    _logger.LogInformation("用户 {UserId} 的 Telegram 账号已重新连接", runtime.UserId);

                    if (runtime.Monitoring)
                        await _clientManager.StartTaskAsync(runtime.UserId);

                    if (runtime.GroupMessageTaskRunning)
                        await _clientManager.StartGroupMessageTaskAsync(runtime.UserId);
                }
                else
                {
                    _logger.LogWarning("用户 {UserId} 的 Telegram 重连未完成，状态：{State}", runtime.UserId, loginResult);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Telegram账号检查失败");
        }
    }
}
