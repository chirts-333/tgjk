namespace TelegramMonitor;

[ApiDescriptionSettings(Tag = "telegram", Description = "Telegram 控制接口")]
public sealed class TelegramService : IDynamicApiController, ITransient
{
    private readonly TelegramClientManager _clientManager;
    private readonly SystemCacheServices _cache;
    private readonly ICurrentUserAccessor _currentUser;

    public TelegramService(
        TelegramClientManager clientManager,
        SystemCacheServices cache,
        ICurrentUserAccessor currentUser)
    {
        _clientManager = clientManager;
        _cache = cache;
        _currentUser = currentUser;
    }

    [HttpPost("login")]
    public Task<LoginState> Login([FromBody] LoginRequest req)
        => _clientManager.LoginAsync(_currentUser.UserId, req.PhoneNumber, req.LoginInfo);

    [HttpPost("proxy")]
    public async Task<LoginState> Proxy([FromBody] ProxyRequest req)
    {
        var status = await _clientManager.GetStatusAsync(_currentUser.UserId);
        bool wasMonitoring = status.Monitoring;
        bool wasGroupSending = status.GroupMessageTaskRunning;

        if (wasMonitoring)
            await _clientManager.StopTaskAsync(_currentUser.UserId);

        if (wasGroupSending)
            await _clientManager.StopGroupMessageTaskAsync(_currentUser.UserId);

        var loginState = await _clientManager.SetProxyAsync(_currentUser.UserId, req.Type, req.Url);

        if (loginState == LoginState.LoggedIn && wasMonitoring)
            await _clientManager.StartTaskAsync(_currentUser.UserId);

        if (loginState == LoginState.LoggedIn && wasGroupSending)
            await _clientManager.StartGroupMessageTaskAsync(_currentUser.UserId);

        return loginState;
    }

    [HttpGet("status")]
    public async Task<TgStatus> Status()
    {
        var status = await _clientManager.GetStatusAsync(_currentUser.UserId);
        return new TgStatus(status.LoggedIn, status.Monitoring, status.GroupMessageTaskRunning, status.PhoneNumber);
    }

    [HttpGet("dialogs")]
    public async Task<List<DisplayDialogs>> Dialogs()
    {
        var status = await _clientManager.GetStatusAsync(_currentUser.UserId);
        if (!status.LoggedIn)
            throw Oops.Oh("未登录");

        return await _clientManager.DialogsAsync(_currentUser.UserId);
    }

    [HttpGet("settings")]
    public async Task<TelegramSettingsResponse> Settings()
    {
        var settings = await _clientManager.GetTelegramSettingsAsync(_currentUser.UserId);
        return new TelegramSettingsResponse(
            settings.DefaultTargetChatId,
            _cache.GetMonitorChatIds(settings));
    }

    [HttpPost("settings")]
    public async Task SaveSettings([FromBody] TelegramSettingsRequest req)
    {
        await _clientManager.SaveTelegramSettingsAsync(
            _currentUser.UserId,
            req.DefaultTargetChatId,
            req.MonitorChatIds ?? new List<long>());
    }

    [HttpPost("start")]
    public Task<MonitorStartResult> Start()
        => _clientManager.StartTaskAsync(_currentUser.UserId);

    [HttpPost("stop")]
    public Task Stop()
        => _clientManager.StopTaskAsync(_currentUser.UserId);

    [HttpPost("clear-session")]
    public Task ClearSession()
        => _clientManager.ClearSessionAsync(_currentUser.UserId);

    [HttpGet("reply-config")]
    public async Task<ReplyConfigResponse> ReplyConfig()
    {
        var cfg = await _cache.GetMonitorReplyConfigAsync(_currentUser.UserId);
        return new ReplyConfigResponse(
            cfg.EnableInChatReply,
            cfg.UseRandomReplyTemplate,
            cfg.DefaultReplyTemplate,
            _cache.GetReplyTemplates(cfg));
    }

    [HttpPost("reply-config")]
    public async Task SaveReplyConfig([FromBody] ReplyConfigRequest req)
    {
        await _cache.SaveMonitorReplyConfigAsync(
            _currentUser.UserId,
            req.EnableInChatReply,
            req.UseRandomReplyTemplate,
            req.DefaultReplyTemplate,
            req.Templates ?? new List<string>());
    }

    [HttpGet("group-task-config")]
    public async Task<GroupTaskConfigResponse> GroupTaskConfig()
    {
        var cfg = await _cache.GetGroupMessageTaskConfigAsync(_currentUser.UserId);
        var status = await _clientManager.GetStatusAsync(_currentUser.UserId);
        return new GroupTaskConfigResponse(
            cfg.PerGroupIntervalSeconds,
            cfg.MinIntervalSeconds,
            cfg.MaxIntervalSeconds,
            _cache.GetGroupMessageTemplates(cfg),
            _cache.GetGroupMessageTargetChatIds(cfg),
            status.GroupMessageTaskRunning);
    }

    [HttpPost("group-task-config")]
    public async Task SaveGroupTaskConfig([FromBody] GroupTaskConfigRequest req)
    {
        await _cache.SaveGroupMessageTaskConfigAsync(
            _currentUser.UserId,
            req.PerGroupIntervalSeconds,
            req.MinIntervalSeconds,
            req.MaxIntervalSeconds,
            req.Templates ?? new List<string>(),
            req.TargetChatIds ?? new List<long>());
    }

    [HttpPost("group-task-start")]
    public Task<GroupMessageTaskStartResult> StartGroupTask()
        => _clientManager.StartGroupMessageTaskAsync(_currentUser.UserId);

    [HttpPost("group-task-stop")]
    public Task StopGroupTask()
        => _clientManager.StopGroupMessageTaskAsync(_currentUser.UserId);
}

public record LoginRequest(string PhoneNumber, string LoginInfo);
public record ProxyRequest(ProxyType Type, string Url);
public record TgStatus(bool LoggedIn, bool Monitoring, bool GroupMessageTaskRunning, string PhoneNumber);
public record TelegramSettingsRequest(long DefaultTargetChatId, List<long> MonitorChatIds);
public record TelegramSettingsResponse(long DefaultTargetChatId, List<long> MonitorChatIds);
public record ReplyConfigRequest(
    bool EnableInChatReply,
    bool UseRandomReplyTemplate,
    string DefaultReplyTemplate,
    List<string> Templates);
public record ReplyConfigResponse(
    bool EnableInChatReply,
    bool UseRandomReplyTemplate,
    string DefaultReplyTemplate,
    List<string> Templates);
public record GroupTaskConfigRequest(
    int PerGroupIntervalSeconds,
    int MinIntervalSeconds,
    int MaxIntervalSeconds,
    List<string> Templates,
    List<long> TargetChatIds);
public record GroupTaskConfigResponse(
    int PerGroupIntervalSeconds,
    int MinIntervalSeconds,
    int MaxIntervalSeconds,
    List<string> Templates,
    List<long> TargetChatIds,
    bool Running);
