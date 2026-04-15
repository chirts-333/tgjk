using System.Collections.Concurrent;
using System.IO;

namespace TelegramMonitor;

public sealed class TelegramClientManager : ISingleton, IAsyncDisposable
{
    private readonly ILoggerFactory _loggerFactory;
    private readonly SystemCacheServices _systemCacheServices;
    private readonly ConcurrentDictionary<int, TelegramUserRuntime> _runtimes = new();
    private readonly ConcurrentDictionary<int, SemaphoreSlim> _runtimeLocks = new();

    public TelegramClientManager(ILoggerFactory loggerFactory, SystemCacheServices systemCacheServices)
    {
        _loggerFactory = loggerFactory;
        _systemCacheServices = systemCacheServices;
    }

    public async Task<LoginState> LoginAsync(int userId, string phoneNumber, string loginInfo)
    {
        var runtime = await GetRuntimeAsync(userId);
        return await runtime.LoginAsync(phoneNumber, loginInfo);
    }

    public async Task<LoginState> ConnectAsync(int userId, string phoneNumber)
    {
        var runtime = await GetRuntimeAsync(userId);
        return await runtime.ConnectAsync(phoneNumber);
    }

    public async Task<LoginState> SetProxyAsync(int userId, ProxyType type, string url)
    {
        var runtime = await GetRuntimeAsync(userId);
        return await runtime.SetProxyAsync(type, url);
    }

    public async Task<List<DisplayDialogs>> DialogsAsync(int userId)
    {
        var runtime = await GetRuntimeAsync(userId);
        return await runtime.DialogsAsync();
    }

    public async Task SaveTelegramSettingsAsync(int userId, long defaultTargetChatId, IEnumerable<long> monitorChatIds)
    {
        var runtime = await GetRuntimeAsync(userId);
        await runtime.SaveTelegramSettingsAsync(defaultTargetChatId, monitorChatIds);
    }

    public async Task<UserTelegramSettings> GetTelegramSettingsAsync(int userId)
    {
        var runtime = await GetRuntimeAsync(userId);
        return await runtime.GetTelegramSettingsAsync();
    }

    public async Task<MonitorStartResult> StartTaskAsync(int userId)
    {
        var runtime = await GetRuntimeAsync(userId);
        return await runtime.StartTaskAsync();
    }

    public async Task StopTaskAsync(int userId)
    {
        var runtime = await GetRuntimeAsync(userId);
        await runtime.StopTaskAsync();
    }

    public async Task<GroupMessageTaskStartResult> StartGroupMessageTaskAsync(int userId)
    {
        var runtime = await GetRuntimeAsync(userId);
        return await runtime.StartGroupMessageTaskAsync();
    }

    public async Task StopGroupMessageTaskAsync(int userId)
    {
        var runtime = await GetRuntimeAsync(userId);
        await runtime.StopGroupMessageTaskAsync();
    }

    public async Task<TelegramRuntimeStatus> GetStatusAsync(int userId)
    {
        var runtime = await GetRuntimeAsync(userId);
        return new TelegramRuntimeStatus(
            runtime.IsLoggedIn,
            runtime.IsMonitoring,
            runtime.IsGroupMessageTaskRunning,
            runtime.GetPhone);
    }

    public async Task ClearSessionAsync(int userId)
    {
        if (_runtimes.TryRemove(userId, out var runtime))
        {
            await runtime.ClearSessionAsync();
            await runtime.DisposeAsync();
            return;
        }

        var userSessionDirectory = Path.Combine(TelegramMonitorConstants.SessionPath, userId.ToString());
        if (Directory.Exists(userSessionDirectory))
            Directory.Delete(userSessionDirectory, true);
    }

    public async Task<List<TelegramRuntimeSummary>> GetRuntimeSummariesAsync()
    {
        var users = await _systemCacheServices.GetEnabledUsersAsync();
        var list = new List<TelegramRuntimeSummary>();

        foreach (var user in users)
        {
            var runtime = await GetRuntimeAsync(user.Id);
            list.Add(new TelegramRuntimeSummary(
                user.Id,
                runtime.GetPhone,
                runtime.IsLoggedIn,
                runtime.IsMonitoring,
                runtime.IsGroupMessageTaskRunning));
        }

        return list;
    }

    public async Task CleanupCachesAsync()
    {
        foreach (var runtime in _runtimes.Values)
        {
            await runtime.CleanupCachesAsync();
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var runtime in _runtimes.Values)
        {
            await runtime.DisposeAsync();
        }

        _runtimes.Clear();
    }

    private async Task<TelegramUserRuntime> GetRuntimeAsync(int userId)
    {
        if (_runtimes.TryGetValue(userId, out var existing))
            return existing;

        var runtimeLock = _runtimeLocks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        await runtimeLock.WaitAsync();
        try
        {
            if (_runtimes.TryGetValue(userId, out existing))
                return existing;

            var runtime = new TelegramUserRuntime(
                userId,
                _loggerFactory.CreateLogger($"TelegramUserRuntime[{userId}]"),
                _systemCacheServices);
            await runtime.InitializeAsync();
            _runtimes[userId] = runtime;
            return runtime;
        }
        finally
        {
            runtimeLock.Release();
        }
    }
}

public sealed record TelegramRuntimeStatus(
    bool LoggedIn,
    bool Monitoring,
    bool GroupMessageTaskRunning,
    string PhoneNumber);

public sealed record TelegramRuntimeSummary(
    int UserId,
    string PhoneNumber,
    bool LoggedIn,
    bool Monitoring,
    bool GroupMessageTaskRunning);
