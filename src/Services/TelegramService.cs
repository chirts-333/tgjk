namespace TelegramMonitor;

[ApiDescriptionSettings(Tag = "telegram", Description = "Telegram 控制接口")]
public class TelegramService : IDynamicApiController, ITransient
{
    private readonly TelegramClientManager _clientManager;
    private readonly SystemCacheServices _cache;

    public TelegramService(TelegramClientManager clientManager, SystemCacheServices cache)
    {
        _clientManager = clientManager;
        _cache = cache;
    }

    [HttpPost("login")]
    public Task<LoginState> Login([FromBody] LoginRequest req)
        => _clientManager.LoginAsync(req.PhoneNumber, req.LoginInfo);

    [HttpPost("proxy")]
    public async Task<LoginState> Proxy([FromBody] ProxyRequest req)
    {
        bool wasMonitoring = _clientManager.IsMonitoring;
        bool wasGroupSending = _clientManager.IsGroupMessageTaskRunning;

        if (wasMonitoring)
            await _clientManager.StopTaskAsync();

        if (wasGroupSending)
            await _clientManager.StopGroupMessageTaskAsync();

        var loginState = await _clientManager.SetProxyAsync(req.Type, req.Url);

        if (loginState == LoginState.LoggedIn && wasMonitoring)
            await _clientManager.StartTaskAsync();

        if (loginState == LoginState.LoggedIn && wasGroupSending)
            await _clientManager.StartGroupMessageTaskAsync();

        return loginState;
    }

    [HttpGet("status")]
    public TgStatus Status()
        => new(_clientManager.IsLoggedIn, _clientManager.IsMonitoring, _clientManager.IsGroupMessageTaskRunning);

    [HttpGet("dialogs")]
    public async Task<List<DisplayDialogs>> Dialogs()
    {
        if (!_clientManager.IsLoggedIn)
            throw Oops.Oh("未登录");

        return await _clientManager.DialogsAsync();
    }

    [HttpPost("target")]
    public void Target([FromBody] long id)
    {
        if (!_clientManager.IsLoggedIn) throw Oops.Oh("未登录");
        _clientManager.SetSendChatId(id);
    }

    [HttpPost("start")]
    public Task<MonitorStartResult> Start()
    {
        return _clientManager.StartTaskAsync();
    }

    [HttpPost("stop")]
    public async Task Stop()
    {
        if (!_clientManager.IsLoggedIn) throw Oops.Oh("未登录");
        await _clientManager.StopTaskAsync();
    }

    [HttpGet("reply-config")]
    public async Task<ReplyConfigResponse> ReplyConfig()
    {
        var cfg = await _cache.GetMonitorReplyConfigAsync();
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
            req.EnableInChatReply,
            req.UseRandomReplyTemplate,
            req.DefaultReplyTemplate,
            req.Templates ?? new List<string>());
    }

    [HttpGet("group-task-config")]
    public async Task<GroupTaskConfigResponse> GroupTaskConfig()
    {
        var cfg = await _cache.GetGroupMessageTaskConfigAsync();
        return new GroupTaskConfigResponse(
            cfg.PerGroupIntervalSeconds,
            cfg.MinIntervalSeconds,
            cfg.MaxIntervalSeconds,
            _cache.GetGroupMessageTemplates(cfg),
            _cache.GetGroupMessageTargetChatIds(cfg),
            _clientManager.IsGroupMessageTaskRunning);
    }

    [HttpPost("group-task-config")]
    public async Task SaveGroupTaskConfig([FromBody] GroupTaskConfigRequest req)
    {
        await _cache.SaveGroupMessageTaskConfigAsync(
            req.PerGroupIntervalSeconds,
            req.MinIntervalSeconds,
            req.MaxIntervalSeconds,
            req.Templates ?? new List<string>(),
            req.TargetChatIds ?? new List<long>());
    }

    [HttpPost("group-task-start")]
    public Task<GroupMessageTaskStartResult> StartGroupTask()
    {
        return _clientManager.StartGroupMessageTaskAsync();
    }

    [HttpPost("group-task-stop")]
    public async Task StopGroupTask()
    {
        await _clientManager.StopGroupMessageTaskAsync();
    }
}

public record LoginRequest(string PhoneNumber, string LoginInfo);
public record ProxyRequest(ProxyType Type, string Url);
public record TgStatus(bool LoggedIn, bool Monitoring, bool GroupMessageTaskRunning);
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
