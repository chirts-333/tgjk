namespace TelegramMonitor;

public sealed class TelegramUserRuntime : IAsyncDisposable
{
    // 统一日志入口，便于追踪登录、拉取消息、发送失败等关键路径。
    private readonly ILogger _logger;
    // WTelegram 客户端，负责实际与 Telegram 服务器通信。
    private Client _client;
    // 更新流管理器，用于持续接收 Update（新消息、编辑、状态变化等）。
    private UpdateManager _manager;
    // 关键词配置服务（数据库读写）。
    private readonly SystemCacheServices _systemCacheServices;

    private string _phone;
    private string _proxyUrl;
    private ProxyType _proxyType = ProxyType.None;
    private Client.TcpFactory _directTcp;
    private long _sendChatId;
    private HashSet<long> _monitorChatIds = new();
    private volatile bool _running;
    private readonly SemaphoreSlim _loginSemaphore = new(1, 1);
    private CancellationTokenSource _groupMessageTaskCts;
    private Task _groupMessageTask;
    private volatile bool _groupMessageTaskRunning;

    public readonly Dictionary<long, User> _users = new Dictionary<long, User>();
    public readonly Dictionary<long, ChatBase> _chats = new Dictionary<long, ChatBase>();
    public int UserId { get; }
    // 只有“正在运行 + 已登录”才视为监控中。
    public bool IsMonitoring => _running && IsLoggedIn;
    public bool IsGroupMessageTaskRunning => _groupMessageTaskRunning;
    public bool IsLoggedIn => _client is { Disconnected: false } && _client.User != null;
    public string GetPhone => _phone ?? string.Empty;

    public TelegramUserRuntime(int userId, ILogger logger, SystemCacheServices systemCacheServices)
    {
        UserId = userId;
        _logger = logger;
        _systemCacheServices = systemCacheServices;
    }

    public async Task InitializeAsync()
    {
        var settings = await _systemCacheServices.GetUserTelegramSettingsAsync(UserId);
        _sendChatId = settings.DefaultTargetChatId;
        _monitorChatIds = _systemCacheServices.GetMonitorChatIds(settings).ToHashSet();
    }

    public async Task SaveTelegramSettingsAsync(long defaultTargetChatId, IEnumerable<long> monitorChatIds)
    {
        _sendChatId = defaultTargetChatId;
        _monitorChatIds = (monitorChatIds ?? Enumerable.Empty<long>())
            .Where(x => x != 0)
            .ToHashSet();
        await _systemCacheServices.SaveUserTelegramSettingsAsync(UserId, _sendChatId, _monitorChatIds);
    }

    public async Task<UserTelegramSettings> GetTelegramSettingsAsync()
    {
        var settings = await _systemCacheServices.GetUserTelegramSettingsAsync(UserId);
        _sendChatId = settings.DefaultTargetChatId;
        _monitorChatIds = _systemCacheServices.GetMonitorChatIds(settings).ToHashSet();
        return settings;
    }

    private string User(long id) => _users.TryGetValue(id, out var user) ? user.ToString() : $"User {id}";

    private string Chat(long id) => _chats.TryGetValue(id, out var chat) ? chat.ToString() : $"Chat {id}";

    private string Peer(Peer peer) => UserOrChat(peer)?.ToString() ?? $"Peer {peer?.ID}";

    public async Task<LoginState> LoginAsync(string phoneNumber, string loginInfo)
    {
        await _loginSemaphore.WaitAsync();
        try
        {
        // 手机号允许去掉空格，但验证码/2FA 密码必须原样保留，避免破坏真实输入。
        phoneNumber = NormalizePhoneNumber(phoneNumber);
        loginInfo = loginInfo ?? string.Empty;
        if (!phoneNumber.IsE164Phone())
            throw new ArgumentException("手机号码格式不正确", nameof(phoneNumber));

        // 切换账号时，销毁旧客户端与旧 UpdateManager，避免会话混用。
        if (phoneNumber != _phone && _client != null)
        {
            await _client.DisposeAsync();
            _client = null;
            _manager = null;
        }

        _phone = phoneNumber;

        EnsureClientCreated();
        ApplyProxy();
        // 首次登录传手机号，后续步骤传验证码/2FA 密码。
        var firstArg = string.IsNullOrEmpty(loginInfo) ? phoneNumber : loginInfo;
        var result = await _client.Login(firstArg);
        _logger.LogInformation("登录流程返回状态: {LoginResult}", result ?? "<logged-in>");

        // Telegram 可能要求补充 name，这里自动填固定值继续流程。
        while (result is "name")
            result = await _client.Login("by riniba");

        return result switch
        {
            "verification_code" => LoginState.WaitingForVerificationCode,
            "password" => LoginState.WaitingForPassword,
            null => IsLoggedIn ? LoginState.LoggedIn : LoginState.NotLoggedIn,
            _ => LoginState.NotLoggedIn
        };
        }
        finally
        {
            _loginSemaphore.Release();
        }
    }

    public async Task<LoginState> ConnectAsync(string phoneNumber)
    {
        await _loginSemaphore.WaitAsync();
        try
        {
            phoneNumber = NormalizePhoneNumber(phoneNumber);
            if (!phoneNumber.IsE164Phone())
                throw new ArgumentException("手机号码格式不正确", nameof(phoneNumber));

            if (phoneNumber != _phone && _client != null)
            {
                await _client.DisposeAsync();
                _client = null;
                _manager = null;
            }

            _phone = phoneNumber;

            EnsureClientCreated();
            ApplyProxy();

            await _client.LoginUserIfNeeded();
            if (IsLoggedIn)
            {
                return LoginState.LoggedIn;
            }
            else
            {
                var result = await _client.Login(phoneNumber);
                while (result is "name")
                    result = await _client.Login("by riniba");

                return result switch
                {
                    "verification_code" => LoginState.WaitingForVerificationCode,
                    "password" => LoginState.WaitingForPassword,
                    null => IsLoggedIn ? LoginState.LoggedIn : LoginState.NotLoggedIn,
                    _ => LoginState.NotLoggedIn
                };
            }
        }
        finally
        {
            _loginSemaphore.Release();
        }
    }

    public async Task<LoginState> SetProxyAsync(ProxyType type, string url)
    {
        await _loginSemaphore.WaitAsync();
        try
        {
        // 先保存配置，再按当前连接状态决定是否立即重建连接。
        _proxyType = type;
        _proxyUrl = url;

        if (_client == null) return LoginState.NotLoggedIn;

        if (!IsLoggedIn)
        {
            ApplyProxy();
            return LoginState.NotLoggedIn;
        }

        string phone = _phone;

        // 已登录时切换代理：重建客户端，确保底层连接参数生效。
        await _client.DisposeAsync();
        _client = null;
        _manager = null;

        EnsureClientCreated();
        ApplyProxy();
        var result = await _client.Login(phone);

        while (result is "name")
            result = await _client.Login("by riniba");

        return result switch
        {
            "verification_code" => LoginState.WaitingForVerificationCode,
            "password" => LoginState.WaitingForPassword,
            null => IsLoggedIn ? LoginState.LoggedIn : LoginState.NotLoggedIn,
            _ => LoginState.NotLoggedIn
        };
        }
        finally
        {
            _loginSemaphore.Release();
        }
    }

    public async Task<Client> GetClientAsync()
    {
        if (_client == null)
            throw new InvalidOperationException("未登录");

        if (_client.Disconnected) await _client.Login(_phone);
        if (!IsLoggedIn) throw new InvalidOperationException("未登录");

        return _client;
    }

    public async Task<List<DisplayDialogs>> DialogsAsync()
    {
        if (_client == null)
            throw new InvalidOperationException("未登录");

        // 拉全量会话并筛选“可监控”的目标。
        var dialogs = await _client.Messages_GetAllDialogs();

        var availableChats = dialogs.chats.Values
            .Where(c => c.IsActive && CanMonitorFast(c))
            .ToList();

        return availableChats.Select(c => new DisplayDialogs
        {
            Id = c.ID,
            DisplayTitle = $"[{GetChatType(c)}]{(string.IsNullOrEmpty(c.MainUsername) ? "" : $"(@{c.MainUsername})")}{c.Title}",
        }).ToList();
    }

    public async Task<MonitorStartResult> StartTaskAsync()
    {
        if (!IsLoggedIn) return MonitorStartResult.Error;
        if (IsMonitoring) return MonitorStartResult.AlreadyRunning;

        try
        {
            var manager = GetUpdateManagerAsync(HandleUpdateAsync);
            var dialogs = await _client.Messages_GetAllDialogs();
            dialogs.CollectUsersChats(_users, _chats);
            if (_client.User == null) return MonitorStartResult.NoUserInfo;

            _running = true;
            _logger.LogInformation("监控启动成功");
            return MonitorStartResult.Started;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "监控启动失败");
            _running = false;
            return MonitorStartResult.Error;
        }
    }

    public async Task StopTaskAsync()
    {
        // 停止后重建登录态，避免 UpdateManager 仍持有旧状态。
        _running = false;
        if (_manager != null)
        {
            await _client.DisposeAsync();
            _manager = null;
            _client = null;
            await LoginAsync(_phone, string.Empty);
        }
        _logger.LogError("主动停止监控");
    }

    public async Task<GroupMessageTaskStartResult> StartGroupMessageTaskAsync()
    {
        if (!IsLoggedIn) return GroupMessageTaskStartResult.NotLoggedIn;
        if (_groupMessageTaskRunning) return GroupMessageTaskStartResult.AlreadyRunning;

        var cfg = await _systemCacheServices.GetGroupMessageTaskConfigAsync(UserId);
        var targetChatIds = _systemCacheServices.GetGroupMessageTargetChatIds(cfg);
        var templates = _systemCacheServices.GetGroupMessageTemplates(cfg);

        if (targetChatIds.Count == 0) return GroupMessageTaskStartResult.MissingTargets;
        if (templates.Count == 0) return GroupMessageTaskStartResult.MissingTemplates;
        if (cfg.PerGroupIntervalSeconds <= 0 ||
            cfg.MinIntervalSeconds <= 0 ||
            cfg.MaxIntervalSeconds < cfg.MinIntervalSeconds)
            return GroupMessageTaskStartResult.InvalidConfig;

        try
        {
            await EnsureDialogsCacheLoadedAsync();

            _groupMessageTaskCts?.Cancel();
            _groupMessageTaskCts?.Dispose();
            _groupMessageTaskCts = new CancellationTokenSource();
            _groupMessageTaskRunning = true;

            _groupMessageTask = RunGroupMessageTaskLoopAsync(_groupMessageTaskCts.Token);
            _logger.LogInformation("群发任务启动成功");
            return GroupMessageTaskStartResult.Started;
        }
        catch (Exception ex)
        {
            _groupMessageTaskRunning = false;
            _logger.LogError(ex, "群发任务启动失败");
            return GroupMessageTaskStartResult.Error;
        }
    }

    public async Task StopGroupMessageTaskAsync()
    {
        var cts = _groupMessageTaskCts;
        _groupMessageTaskRunning = false;
        _groupMessageTaskCts = null;

        if (cts == null) return;

        try
        {
            await cts.CancelAsync();
        }
        catch
        {
        }

        try
        {
            if (_groupMessageTask != null)
                await _groupMessageTask;
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            cts.Dispose();
            _groupMessageTask = null;
            _logger.LogInformation("群发任务已停止");
        }
    }

    public async Task ClearSessionAsync()
    {
        await _loginSemaphore.WaitAsync();
        try
        {
            _running = false;
            await StopGroupMessageTaskAsync();

            if (_client != null)
            {
                await _client.DisposeAsync();
                _client = null;
            }

            _manager = null;
            _users.Clear();
            _chats.Clear();
            _phone = string.Empty;

            var userSessionDirectory = Path.Combine(TelegramMonitorConstants.SessionPath, UserId.ToString());
            if (Directory.Exists(userSessionDirectory))
                Directory.Delete(userSessionDirectory, true);
        }
        finally
        {
            _loginSemaphore.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopGroupMessageTaskAsync();
        if (_client != null) await _client.DisposeAsync();
        _client = null;
        _manager = null;
        _users.Clear();
        _chats.Clear();
    }

    public async Task CleanupCachesAsync()
    {
        await _loginSemaphore.WaitAsync();
        try
        {
            int userCount = _users.Count;
            int chatCount = _chats.Count;

            _users.Clear();
            _chats.Clear();

            if (IsLoggedIn)
            {
                var dialogs = await _client.Messages_GetAllDialogs();
                dialogs.CollectUsersChats(_users, _chats);
            }

            _logger.LogInformation(
                "已清理运行时缓存，Users: {OldUserCount} -> {NewUserCount}, Chats: {OldChatCount} -> {NewChatCount}",
                userCount,
                _users.Count,
                chatCount,
                _chats.Count);
        }
        finally
        {
            _loginSemaphore.Release();
        }
    }

    private UpdateManager GetUpdateManagerAsync(Func<Update, Task> onUpdate)
    {
        if (_manager != null) return _manager;
        // 自定义 collector 负责持续维护 _users/_chats 的最新视图。
        _manager = _client.WithUpdateManager(onUpdate, collector: new MyCollector(_users, _chats));
        return _manager;
    }

    private async Task EnsureDialogsCacheLoadedAsync()
    {
        if (!IsLoggedIn) return;

        var dialogs = await _client.Messages_GetAllDialogs();
        dialogs.CollectUsersChats(_users, _chats);
    }

    private void EnsureClientCreated()
    {
        if (_client != null) return;
        // session 文件以手机号命名，支持多账号隔离。
        var userSessionDirectory = Path.Combine(TelegramMonitorConstants.SessionPath, UserId.ToString());
        Directory.CreateDirectory(userSessionDirectory);
        _client = new Client(
            TelegramMonitorConstants.ApiId,
            TelegramMonitorConstants.ApiHash,
            Path.Combine(userSessionDirectory, $"{_phone}.session"));
        _directTcp = _client.TcpHandler;
    }

    private static string NormalizePhoneNumber(string phoneNumber)
    {
        return (phoneNumber ?? string.Empty).Replace(" ", string.Empty).Trim();
    }

    private void ApplyProxy()
    {
        if (_client == null) return;

        switch (_proxyType)
        {
            case ProxyType.Socks5:
                // Socks5 通过自定义 TcpHandler 接管底层连接。
                _client.TcpHandler = (host, port) =>
                {
                    var p = Socks5ProxyClient.Parse(_proxyUrl);
                    return Task.FromResult(p.CreateConnection(host, port));
                };
                _client.MTProxyUrl = null;
                break;

            case ProxyType.MTProxy:
                // MTProxy 走官方字段，TCP 回退到默认直连处理器。
                _client.MTProxyUrl = _proxyUrl;
                _client.TcpHandler = _directTcp;
                break;

            case ProxyType.None:
            default:
                _client.TcpHandler = _directTcp;
                _client.MTProxyUrl = null;
                break;
        }
    }

    private IPeerInfo UserOrChat(Peer peer)
    {
        if (peer is PeerUser pu)
            return _users.TryGetValue(pu.user_id, out var u) ? u : null;
        if (peer is PeerChat pc)
            return _chats.TryGetValue(pc.chat_id, out var c) ? c : null;
        if (peer is PeerChannel pch)
            return _chats.TryGetValue(pch.channel_id, out var c2) ? c2 : null;
        return null;
    }

    private async Task EnsureUsersAndChatsFromMessageAsync(Message message)
    {
        // 对“min”对象做补全，避免用户名/标题缺失导致解析失败。
        if (message.From is PeerUser peerUser)
        {
            try
            {
                var user = _users.GetValueOrDefault(message.from_id);
                if (user.flags.HasFlag(TL.User.Flags.min))
                {
                    var full = await _client.Users_GetFullUser(new InputUserFromMessage()
                    {
                        user_id = message.From.ID,
                        msg_id = message.ID,
                        peer = _chats[message.Peer.ID].ToInputPeer()
                    });
                    full.CollectUsersChats(_users, _chats);
                }
            }
            catch (Exception ex)
            {
                Log.Warning("拉取用户 {UserId} 失败: {@Exception}", peerUser.user_id, ex);
            }
        }
        if (message.Peer is PeerUser peerPeerUser)
        {
            try
            {
                var user = _users.GetValueOrDefault(message.peer_id);
                if (user.flags.HasFlag(TL.User.Flags.min))
                {
                    var full = await _client.Users_GetFullUser(new InputUserFromMessage()
                    {
                        user_id = message.From.ID,
                        msg_id = message.ID,
                        peer = _users[message.Peer.ID].ToInputPeer()
                    });
                    full.CollectUsersChats(_users, _chats);
                }
            }
            catch (Exception ex)
            {
                Log.Warning("拉取用户 {UserId} 失败: {@Exception}", peerPeerUser.user_id, ex);
            }
        }
        if (message.Peer is PeerChannel peerChannel)
        {
            try
            {
                var channel = _chats.GetValueOrDefault(message.peer_id) as TL.Channel;
                if (channel.flags.HasFlag(TL.Channel.Flags.min))
                {
                    var full = await _client.Channels_GetFullChannel(new InputChannelFromMessage()
                    {
                        channel_id = peerChannel.channel_id,
                        msg_id = message.ID,
                        peer = _chats[message.Peer.ID].ToInputPeer()
                    });
                    full.CollectUsersChats(_users, _chats);
                }
            }
            catch (Exception ex)
            {
                Log.Warning("拉取频道 {channel_id} 失败: {@Exception}", peerChannel.channel_id, ex);
            }
        }
    }

    private async Task HandleUpdateAsync(Update update)
    {
        try
        {
            // 按 Update 类型分发，核心只对新消息做业务处理，其它主要记录日志。
            switch (update)
            {
                case UpdateNewMessage unm:
                    await HandleMessageAsync(unm.message);
                    break;

                case UpdateEditMessage uem:
                    _logger.LogInformation(
                        "{User} edited a message in {Chat}",
                        User(uem.message.From),
                        Chat(uem.message.Peer));
                    break;

                case UpdateDeleteChannelMessages udcm:
                    _logger.LogInformation("{Count} message(s) deleted in {Chat}",
                                           udcm.messages.Length,
                                           Chat(udcm.channel_id));
                    break;

                case UpdateDeleteMessages udm:
                    _logger.LogInformation("{Count} message(s) deleted",
                                           udm.messages.Length);
                    break;

                case UpdateUserTyping uut:
                    _logger.LogInformation("{User} is {Action}",
                                           User(uut.user_id), uut.action);
                    break;

                case UpdateChatUserTyping ucut:
                    _logger.LogInformation("{Peer} is {Action} in {Chat}",
                                           Peer(ucut.from_id), ucut.action,
                                           Chat(ucut.chat_id));
                    break;

                case UpdateChannelUserTyping ucut2:
                    _logger.LogInformation("{Peer} is {Action} in {Chat}",
                                           Peer(ucut2.from_id), ucut2.action,
                                           Chat(ucut2.channel_id));
                    break;

                case UpdateChatParticipants { participants: ChatParticipants cp }:
                    _logger.LogInformation("{Count} participants in {Chat}",
                                           cp.participants.Length,
                                           Chat(cp.chat_id));
                    break;

                case UpdateUserStatus uus:
                    _logger.LogInformation("{User} is now {Status}",
                                           User(uus.user_id),
                                           uus.status.GetType().Name[10..]);
                    break;

                case UpdateUserName uun:
                    _logger.LogInformation("{User} changed profile name: {FN} {LN}",
                                           User(uun.user_id),
                                           uun.first_name, uun.last_name);
                    break;

                case UpdateUser uu:
                    _logger.LogInformation("{User} changed infos/photo",
                                           User(uu.user_id));
                    break;

                default:
                    _logger.LogInformation(update.GetType().Name);
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "处理 Update 时发生异常");
        }
    }

    private string GetChatType(ChatBase chat) => chat switch
    {
        TL.Chat => "Chat",
        TL.Channel ch when ch.IsChannel => "Channel",
        TL.Channel => "Group",
        _ => "Unknown"
    };

    private bool CanSendMessages(ChatBase chat) => chat switch
    {
        TL.Chat small => !small.IsBanned(ChatBannedRights.Flags.send_messages),
        TL.Channel ch when ch.IsChannel => !ch.IsBanned(ChatBannedRights.Flags.send_messages),
        TL.Channel group => !group.IsBanned(ChatBannedRights.Flags.send_messages),
        _ => false
    };

    private static bool CanSendMessagesFast(ChatBase chat)
    {
        // 仅做快速权限判定，避免把无法发消息的会话放进目标列表。
        switch (chat)
        {
            case Chat small:
                return !small.IsBanned(ChatBannedRights.Flags.send_messages);

            case Channel ch when ch.IsChannel:
                if (ch.flags.HasFlag(Channel.Flags.left)) return false;
                if (ch.flags.HasFlag(Channel.Flags.creator)) return true;
                return ch.admin_rights?.flags.HasFlag(ChatAdminRights.Flags.post_messages) == true;

            case Channel ch:
                if (ch.flags.HasFlag(Channel.Flags.left)) return false;
                if (ch.flags.HasFlag(Channel.Flags.creator)) return true;
                if (ch.admin_rights?.flags != 0) return true;
                return !ch.IsBanned(ChatBannedRights.Flags.send_messages);

            default:
                return false;
        }
    }

    private static bool CanMonitorFast(ChatBase chat)
    {
        // 监控列表允许展示“可接收消息”的群组和频道，不要求一定具备发言权限。
        switch (chat)
        {
            case TL.Chat:
                return true;

            case Channel ch:
                return !ch.flags.HasFlag(Channel.Flags.left);

            default:
                return false;
        }
    }

    private async Task HandleMessageAsync(MessageBase messageBase)
    {
        try
        {
            switch (messageBase)
            {
                case Message m:
                    await HandleTelegramMessageAsync(m);
                    break;

                case MessageService ms:
                    _logger.LogInformation("{From} in {Peer} [{Action}]",
                                         UserOrChat(ms.from_id),
                                         UserOrChat(ms.peer_id),
                                         ms.action.GetType().Name[13..]);
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "处理消息时发生异常");
        }
    }

    private async Task HandleTelegramMessageAsync(TL.Message message)
    {
        // 空文本（纯媒体等）直接跳过。
        if (string.IsNullOrWhiteSpace(message.message))
        {
            return;
        }
        var keywords = await _systemCacheServices.GetKeywordsAsync(UserId) ?? new List<KeywordConfig>();
        // 先做正文关键词匹配。
        var matchedKeywords = KeywordMatchExtensions.MatchText(message.message, keywords);

        if (matchedKeywords.Any(k => k.KeywordAction == KeywordAction.Exclude))
        {
            _logger.LogInformation("消息 {message}包含排除关键词 {keywords}，跳过",message.message, string.Join(",", matchedKeywords));
            return;
        }

        matchedKeywords = matchedKeywords
            .Where(k => k.KeywordAction == KeywordAction.Monitor)
            .ToList();

        if (matchedKeywords.Count == 0)
        {
            _logger.LogInformation("消息 {message} 无匹配关键词，跳过", message.message);
            return;
        }

        if (message.Peer is null)
        {
            _logger.LogWarning("消息 {MessageId} 没有 Peer 信息，无法处理", message.ID);
            return;
        }

        if (_monitorChatIds.Count == 0 || !_monitorChatIds.Contains(message.Peer.ID))
        {
            _logger.LogDebug("消息 {MessageId} 所在会话未被当前用户选为监控目标，跳过", message.ID);
            return;
        }

        await EnsureUsersAndChatsFromMessageAsync(message);

        var sendEntity = BuildSendEntity(message);
        if (sendEntity is null)
        {
            _logger.LogWarning("无法解析消息的来源或发送者，跳过");
            return;
        }

        _logger.LogInformation(
            "{Nick} (ID:{Uid}) 在 {Chat} (ID:{Chatid}) 中发送：{Text}",
            sendEntity.SendTitle, sendEntity.SendId,
            sendEntity.FromTitle, sendEntity.FromId, message.message);

        var matchedUserKeywords = KeywordMatchExtensions.MatchUser(
            sendEntity.SendId,
            sendEntity.SendUserNames?.ToList() ?? new List<string>(),
            keywords);

        // 用户关键词优先级高于正文关键词：命中用户监控规则则覆盖正文规则。
        if (matchedUserKeywords.Any(k => k.KeywordAction == KeywordAction.Exclude))
        {
            _logger.LogInformation(" (ID:{Uid}) 在排除列表内，跳过", sendEntity.SendId);
            return;
        }

        var finalKeywords = matchedUserKeywords.Any(k => k.KeywordAction == KeywordAction.Monitor)
            ? (IReadOnlyList<KeywordConfig>)matchedUserKeywords
            : matchedKeywords;

        await SendMonitorMessagesAsync(message, sendEntity, finalKeywords);
        await SendInChatKeywordReplyAsync(message, sendEntity, finalKeywords);
    }

    private SendMessageEntity? BuildSendEntity(TL.Message message)
    {
        if (message.Peer is null) return null;

        // 先解析“消息来源会话”（群/频道/私聊对象）。
        if (!TryResolvePeer(message.Peer, out var fromId, out var fromTitle, out var fromMain, out var fromUserNames))
        {
            return null;
        }

        long sendId; string sendTitle; string sendMain; IEnumerable<string> sendUserNames;
        if (message.From is null)
        {
            // 某些频道贴文没有 From，按频道自身作为发送者处理。
            var isChannelPostFlag = message.flags.HasFlag(TL.Message.Flags.post);
            var isBroadcastChannel =
                _chats.TryGetValue(fromId, out var fromChat)
                && fromChat is TL.Channel fromChannel
                && fromChannel.IsChannel;

            if (isChannelPostFlag || isBroadcastChannel)
            {
                sendId = fromId;
                sendTitle = fromTitle;
                sendMain = fromMain;
                sendUserNames = fromUserNames;
            }
            else if (message.Peer is TL.PeerUser && message.flags.HasFlag(TL.Message.Flags.out_))
            {
                // 私聊中本机主动发出的消息：发送者应映射为当前登录用户。
                var me = _client.User;
                if (me is null) return null;

                sendId = me.ID;
                sendTitle = $"{me.first_name} {me.last_name}".Trim();
                sendMain = me.MainUsername;
                sendUserNames = me.ActiveUsernames ?? Enumerable.Empty<string>();
            }
            else
            {
                sendId = fromId;
                sendTitle = fromTitle;
                sendMain = fromMain;
                sendUserNames = fromUserNames;
            }
        }
        else if (!TryResolvePeer(message.From, out sendId, out sendTitle, out sendMain, out sendUserNames))
        {
            return null;
        }

        return new SendMessageEntity
        {
            FromId = fromId,
            FromTitle = fromTitle,
            FromMainUserName = fromMain,
            FromUserNames = fromUserNames,

            SendId = sendId,
            SendTitle = sendTitle,
            SendUserNames = sendUserNames
        };
    }

    private async Task SendMonitorMessagesAsync(
        Message originalMessage,
        SendMessageEntity sendEntity,
        IReadOnlyList<KeywordConfig> finalKeywords)
    {
        var routePlans = BuildForwardPlans(finalKeywords);
        foreach (var plan in routePlans)
        {
            await SendMonitorMessageAsync(originalMessage, sendEntity, plan);
        }
    }

    private async Task SendMonitorMessageAsync(
        Message originalMessage,
        SendMessageEntity sendEntity,
        MonitorForwardPlan plan)
    {
        try
        {
            if (plan.TargetChatId == 0)
            {
                _logger.LogWarning("监控消息未设置发送目标");
                return;
            }

            var chat = _chats.GetValueOrDefault(plan.TargetChatId);
            if (chat == null)
            {
                _logger.LogWarning("无法找到 ID 为 {Id} 的发送目标", plan.TargetChatId);
                return;
            }

            if (plan.ForwardMode == KeywordForwardMode.PlainText)
            {
                var plainText = originalMessage.message?.Trim();
                if (string.IsNullOrWhiteSpace(plainText))
                {
                    _logger.LogWarning("监控消息原文为空，无法执行纯消息内容转发");
                    return;
                }

                await _client.SendMessageAsync(
                    chat,
                    plainText,
                    preview: Client.LinkPreview.Disabled,
                    media: originalMessage.media?.ToInputMedia());
                return;
            }

            var content = originalMessage.FormatForMonitor(sendEntity, plan.Keywords, plan.IncludeSource);
            // 使用 Markdown 实体，保留关键词样式和消息链接。
            var entities = _client.MarkdownToEntities(ref content, users: _users);
            await _client.SendMessageAsync(
                chat,
                content,
                preview: Client.LinkPreview.Disabled,
                entities: entities,
                media: originalMessage.media?.ToInputMedia());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "发送监控消息失败");
        }
    }

    private List<MonitorForwardPlan> BuildForwardPlans(IReadOnlyList<KeywordConfig> finalKeywords)
    {
        var routes = finalKeywords
            .Where(k => k.KeywordAction == KeywordAction.Monitor)
            .SelectMany(keyword => GetKeywordTargetRoutes(keyword)
                .Select(route => new
                {
                    route.TargetChatId,
                    route.IncludeSource,
                    route.ForwardMode,
                    Keyword = keyword
                }))
            .ToList();

        var plans = routes
            .GroupBy(item => new
            {
                item.TargetChatId,
                item.IncludeSource,
                item.ForwardMode
            })
            .Select(g => new MonitorForwardPlan(
                g.Key.TargetChatId,
                g.Key.IncludeSource,
                g.Key.ForwardMode,
                g.Select(x => x.Keyword).ToList()))
            .Where(p => p.TargetChatId != 0)
            .ToList();

        if (plans.Count == 0 && finalKeywords.Any(k => k.KeywordAction == KeywordAction.Monitor))
        {
            _logger.LogWarning("命中监控关键词，但当前没有可用的转发目标");
        }

        return plans;
    }

    private IEnumerable<KeywordTargetRoute> GetKeywordTargetRoutes(KeywordConfig keyword)
    {
        if (keyword.TargetRoutes?.Count > 0)
            return keyword.TargetRoutes;

        if (keyword.TargetChatId != 0)
        {
            return new[]
            {
                new KeywordTargetRoute
                {
                    TargetChatId = keyword.TargetChatId,
                    IncludeSource = true
                }
            };
        }

        if (_sendChatId == 0)
            return Enumerable.Empty<KeywordTargetRoute>();

        return new[]
        {
            new KeywordTargetRoute
            {
                TargetChatId = _sendChatId,
                IncludeSource = true
            }
        };
    }

    private async Task SendInChatKeywordReplyAsync(
        Message originalMessage,
        SendMessageEntity sendEntity,
        IReadOnlyList<KeywordConfig> finalKeywords)
    {
        var replyConfig = await _systemCacheServices.GetMonitorReplyConfigAsync(UserId);
        if (!replyConfig.EnableInChatReply) return;

        if (originalMessage.Peer is null)
        {
            _logger.LogWarning("原消息无 Peer，无法在原会话回复");
            return;
        }

        var currentChat = UserOrChat(originalMessage.Peer);
        if (currentChat is null)
        {
            _logger.LogWarning("无法解析原会话，无法执行自动回复");
            return;
        }

        var templates = _systemCacheServices.GetReplyTemplates(replyConfig);
        var replyText = BuildInChatReplyText(sendEntity, finalKeywords, replyConfig, templates);
        if (string.IsNullOrWhiteSpace(replyText))
        {
            _logger.LogWarning("自动回复内容为空，跳过发送");
            return;
        }

        try
        {
            await _client.SendMessageAsync(
                currentChat.ToInputPeer(),
                replyText,
                reply_to_msg_id: originalMessage.id);
            _logger.LogInformation(
                "已在原会话 {ChatTitle}(ID:{ChatId}) 回复命中消息发送者 {SenderTitle}(ID:{SenderId})",
                sendEntity.FromTitle, sendEntity.FromId, sendEntity.SendTitle, sendEntity.SendId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "在原会话自动回复失败");
        }
    }

    private string BuildInChatReplyText(
        SendMessageEntity sendEntity,
        IReadOnlyList<KeywordConfig> finalKeywords,
        MonitorReplyConfig replyConfig,
        IReadOnlyList<string> templates)
    {
        string template = replyConfig.DefaultReplyTemplate;
        if (replyConfig.UseRandomReplyTemplate && templates.Count > 0)
        {
            template = templates[Random.Shared.Next(templates.Count)];
        }

        if (string.IsNullOrWhiteSpace(template))
        {
            template = "收到，{sender}，你的消息命中了关键词：{keywords}";
        }

        var sender = string.IsNullOrWhiteSpace(sendEntity.SendTitle)
            ? $"ID:{sendEntity.SendId}"
            : sendEntity.SendTitle;

        var keywords = string.Join(",",
            finalKeywords
                .Select(k => k.KeywordContent?.Trim())
                .Where(k => !string.IsNullOrWhiteSpace(k))
                .Distinct(StringComparer.OrdinalIgnoreCase));

        return template
            .Replace("{sender}", sender)
            .Replace("{keywords}", keywords)
            .Replace("{chat}", sendEntity.FromTitle ?? string.Empty);
    }

    private async Task RunGroupMessageTaskLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var cfg = await _systemCacheServices.GetGroupMessageTaskConfigAsync(UserId);
                var targetChatIds = _systemCacheServices.GetGroupMessageTargetChatIds(cfg);
                var templates = _systemCacheServices.GetGroupMessageTemplates(cfg);

                if (!IsLoggedIn)
                {
                    _logger.LogWarning("群发任务检测到当前账号未登录，本轮跳过");
                }
                else if (targetChatIds.Count == 0 || templates.Count == 0)
                {
                    _logger.LogWarning("群发任务缺少目标群组或模板，本轮跳过");
                }
                else
                {
                    await EnsureDialogsCacheLoadedAsync();
                    await SendRandomTemplateToChatsAsync(
                        targetChatIds,
                        templates,
                        cfg.PerGroupIntervalSeconds,
                        cancellationToken);
                }

                int delaySeconds = Random.Shared.Next(cfg.MinIntervalSeconds, cfg.MaxIntervalSeconds + 1);
                _logger.LogInformation("群发任务本轮结束，等待 {DelaySeconds} 秒后开始下一轮", delaySeconds);
                await Task.Delay(TimeSpan.FromSeconds(delaySeconds), cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "群发任务循环异常退出");
        }
        finally
        {
            _groupMessageTaskRunning = false;
        }
    }

    private async Task SendRandomTemplateToChatsAsync(
        IReadOnlyCollection<long> targetChatIds,
        IReadOnlyList<string> templates,
        int perGroupIntervalSeconds,
        CancellationToken cancellationToken)
    {
        var chatIds = targetChatIds.ToList();
        for (int index = 0; index < chatIds.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var chatId = chatIds[index];

            var chat = _chats.GetValueOrDefault(chatId);
            if (chat == null)
            {
                _logger.LogWarning("群发任务找不到会话 {ChatId}，跳过", chatId);
            }
            else if (!CanSendMessages(chat))
            {
                _logger.LogWarning("群发任务对会话 {ChatId} 无发送权限，跳过", chatId);
            }
            else
            {
                var text = templates[Random.Shared.Next(templates.Count)];
                if (!string.IsNullOrWhiteSpace(text))
                {
                    try
                    {
                        await _client.SendMessageAsync(chat.ToInputPeer(), text.Trim());
                        _logger.LogInformation("群发任务已向 {ChatTitle}(ID:{ChatId}) 发送消息", chat.Title, chat.ID);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "群发任务向 {ChatId} 发送消息失败", chatId);
                    }
                }
            }

            if (index < chatIds.Count - 1)
            {
                _logger.LogInformation(
                    "群发任务等待 {DelaySeconds} 秒后发送下一个群组",
                    perGroupIntervalSeconds);
                await Task.Delay(TimeSpan.FromSeconds(perGroupIntervalSeconds), cancellationToken);
            }
        }
    }

    private bool TryResolvePeer(
        TL.Peer peer,
        out long id, out string title,
        out string mainUserName, out IEnumerable<string> allUserNames)
    {
        // 把不同 Peer 类型统一解析为“可展示 + 可匹配”的实体信息。
        id = 0; title = null; mainUserName = null; allUserNames = [];
        if (peer is null) return false;

        if (peer is TL.PeerUser pu)
        {
            if (_users.TryGetValue(pu.user_id, out var u))
            {
                id = u.ID;
                title = u.DisplayName();
                mainUserName = u.MainUsername;
                allUserNames = u.ActiveUsernames ?? Enumerable.Empty<string>(); ;
                return true;
            }
            return false;
        }
        if (peer is TL.PeerChat pc)
        {
            if (_chats.TryGetValue(pc.chat_id, out var smallGroup))
            {
                id = smallGroup.ID;
                title = smallGroup.Title;
                mainUserName = smallGroup.MainUsername;
                allUserNames = smallGroup.MainUsername != null
                ? new[] { smallGroup.MainUsername }
                : Enumerable.Empty<string>();
                ;
                return true;
            }
            return false;
        }
        if (peer is TL.PeerChannel pch)
        {
            if (_chats.TryGetValue(pch.channel_id, out var chatBase))
            {
                id = chatBase.ID;
                title = chatBase.Title;
                mainUserName = chatBase.MainUsername;
                allUserNames = chatBase is TL.Channel ch
                ? (ch.ActiveUsernames ?? Enumerable.Empty<string>())
                : (chatBase.MainUsername != null
                    ? new[] { chatBase.MainUsername }
                    : Enumerable.Empty<string>());
                return true;
            }
            return false;
        }
        return false;
    }

    private sealed record MonitorForwardPlan(
        long TargetChatId,
        bool IncludeSource,
        KeywordForwardMode ForwardMode,
        IReadOnlyList<KeywordConfig> Keywords);
}
