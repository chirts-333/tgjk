using Microsoft.Data.Sqlite;

namespace TelegramMonitor;

public class SystemCacheServices : ISingleton
{
    private readonly ISqlSugarClient _db;

    public SystemCacheServices(ISqlSugarClient db)
    {
        _db = db;
    }

    public async Task<List<KeywordConfig>> GetKeywordsAsync(int userId)
    {
        var list = await _db.Queryable<KeywordConfig>()
            .Where(x => x.UserId == userId)
            .ToListAsync();
        return list.Select(NormalizeKeywordConfig).ToList();
    }

    public async Task<List<UserAccount>> GetEnabledUsersAsync()
    {
        var now = DateTime.UtcNow;
        var users = await _db.Queryable<UserAccount>()
            .Where(x => x.IsEnabled)
            .ToListAsync();
        return users
            .Where(x => !x.ExpiresAtUtc.HasValue || x.ExpiresAtUtc > now)
            .ToList();
    }

    public async Task AddKeywordsAsync(int userId, KeywordConfig keyword)
    {
        keyword.UserId = userId;
        NormalizeKeywordConfig(keyword);
        var list = await GetKeywordsAsync(userId);
        if (list.Any(k => k.KeywordType == keyword.KeywordType &&
                          k.KeywordContent.Equals(keyword.KeywordContent, StringComparison.OrdinalIgnoreCase)))
        {
            throw Oops.Oh("Keyword already exists");
        }

        keyword.Id = await _db.Insertable(keyword).ExecuteReturnIdentityAsync();
    }

    public async Task BatchAddKeywordsAsync(int userId, List<KeywordConfig> keywords)
    {
        keywords = keywords?.Select(keyword =>
        {
            keyword.UserId = userId;
            return NormalizeKeywordConfig(keyword);
        }).ToList() ?? new List<KeywordConfig>();
        var list = await GetKeywordsAsync(userId);

        var toAdd = keywords
            .Where(k => !list.Any(e => e.KeywordType == k.KeywordType &&
                                       e.KeywordContent.Equals(k.KeywordContent, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (toAdd.Count == 0)
            throw Oops.Oh("All keywords already exist");

        await _db.Insertable(toAdd).ExecuteCommandAsync();
    }

    public async Task UpdateKeywordsAsync(int userId, KeywordConfig keyword)
    {
        keyword.UserId = userId;
        NormalizeKeywordConfig(keyword);
        var list = await GetKeywordsAsync(userId);
        if (list.Any(k => k.Id != keyword.Id &&
                          k.KeywordType == keyword.KeywordType &&
                          k.KeywordContent.Equals(keyword.KeywordContent, StringComparison.OrdinalIgnoreCase)))
        {
            throw Oops.Oh("Keyword already exists");
        }

        await _db.Updateable(keyword).ExecuteCommandAsync();
    }

    public async Task DeleteKeywordsAsync(int userId, int id)
    {
        await _db.Deleteable<KeywordConfig>()
            .Where(x => x.UserId == userId && x.Id == id)
            .ExecuteCommandAsync();
    }

    public async Task BatchDeleteKeywordsAsync(int userId, IEnumerable<int> ids)
    {
        var idArr = ids.ToArray();
        await _db.Deleteable<KeywordConfig>()
            .Where(x => x.UserId == userId && idArr.Contains(x.Id))
            .ExecuteCommandAsync();
    }

    public async Task<MonitorReplyConfig> GetMonitorReplyConfigAsync(int userId)
    {
        var cfg = await _db.Queryable<MonitorReplyConfig>().InSingleAsync(userId);
        if (cfg != null) return NormalizeReplyConfig(cfg);

        var created = NormalizeReplyConfig(new MonitorReplyConfig { Id = userId });
        await _db.Insertable(created).ExecuteCommandAsync();
        return created;
    }

    public async Task SaveMonitorReplyConfigAsync(
        int userId,
        bool enableInChatReply,
        bool useRandomReplyTemplate,
        string defaultReplyTemplate,
        IEnumerable<string> templates)
    {
        var entity = new MonitorReplyConfig
        {
            Id = userId,
            EnableInChatReply = enableInChatReply,
            UseRandomReplyTemplate = useRandomReplyTemplate,
            DefaultReplyTemplate = string.IsNullOrWhiteSpace(defaultReplyTemplate)
                ? "Received, {sender}, your message matched keywords: {keywords}"
                : defaultReplyTemplate.Trim(),
            ReplyTemplatesJson = JsonSerializer.Serialize(NormalizeStringList(templates))
        };

        var exists = await _db.Queryable<MonitorReplyConfig>().AnyAsync(x => x.Id == userId);
        if (exists)
            await _db.Updateable(entity).ExecuteCommandAsync();
        else
            await _db.Insertable(entity).ExecuteCommandAsync();
    }

    public List<string> GetReplyTemplates(MonitorReplyConfig cfg)
    {
        return DeserializeStringList(cfg?.ReplyTemplatesJson);
    }

    public async Task<GroupMessageTaskConfig> GetGroupMessageTaskConfigAsync(int userId)
    {
        var cfg = await _db.Queryable<GroupMessageTaskConfig>().InSingleAsync(userId);
        if (cfg != null) return NormalizeGroupTaskConfig(cfg);

        var created = NormalizeGroupTaskConfig(new GroupMessageTaskConfig { Id = userId });
        await _db.Insertable(created).ExecuteCommandAsync();
        return created;
    }

    public async Task SaveGroupMessageTaskConfigAsync(
        int userId,
        int perGroupIntervalSeconds,
        int minIntervalSeconds,
        int maxIntervalSeconds,
        IEnumerable<string> templates,
        IEnumerable<long> targetChatIds)
    {
        perGroupIntervalSeconds = Math.Max(1, perGroupIntervalSeconds);
        minIntervalSeconds = Math.Max(5, minIntervalSeconds);
        maxIntervalSeconds = Math.Max(minIntervalSeconds, maxIntervalSeconds);

        var entity = new GroupMessageTaskConfig
        {
            Id = userId,
            PerGroupIntervalSeconds = perGroupIntervalSeconds,
            MinIntervalSeconds = minIntervalSeconds,
            MaxIntervalSeconds = maxIntervalSeconds,
            TemplatesJson = JsonSerializer.Serialize(NormalizeStringList(templates)),
            TargetChatIdsJson = JsonSerializer.Serialize(NormalizeLongList(targetChatIds))
        };

        var exists = await _db.Queryable<GroupMessageTaskConfig>().AnyAsync(x => x.Id == userId);
        if (exists)
            await _db.Updateable(entity).ExecuteCommandAsync();
        else
            await _db.Insertable(entity).ExecuteCommandAsync();
    }

    public async Task<UserTelegramSettings> GetUserTelegramSettingsAsync(int userId)
    {
        var settings = await _db.Queryable<UserTelegramSettings>().InSingleAsync(userId);
        if (settings != null)
            return NormalizeUserTelegramSettings(settings, userId);

        var created = NormalizeUserTelegramSettings(new UserTelegramSettings { UserId = userId }, userId);
        try
        {
            await _db.Insertable(created).ExecuteCommandAsync();
            return created;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            var existing = await _db.Queryable<UserTelegramSettings>().InSingleAsync(userId);
            if (existing != null)
                return NormalizeUserTelegramSettings(existing, userId);

            throw;
        }
    }

    public async Task SaveUserTelegramSettingsAsync(int userId, long defaultTargetChatId, IEnumerable<long> monitorChatIds)
    {
        var entity = NormalizeUserTelegramSettings(new UserTelegramSettings
        {
            UserId = userId,
            DefaultTargetChatId = defaultTargetChatId,
            MonitorChatIdsJson = JsonSerializer.Serialize(NormalizeLongList(monitorChatIds))
        }, userId);

        var exists = await _db.Queryable<UserTelegramSettings>().AnyAsync(x => x.UserId == userId);
        if (exists)
            await _db.Updateable(entity).ExecuteCommandAsync();
        else
        {
            try
            {
                await _db.Insertable(entity).ExecuteCommandAsync();
            }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
            {
                await _db.Updateable(entity).ExecuteCommandAsync();
            }
        }
    }

    public List<long> GetMonitorChatIds(UserTelegramSettings settings)
    {
        if (settings is null || string.IsNullOrWhiteSpace(settings.MonitorChatIdsJson))
            return new List<long>();

        try
        {
            var list = JsonSerializer.Deserialize<List<long>>(settings.MonitorChatIdsJson);
            return NormalizeLongList(list);
        }
        catch
        {
            return new List<long>();
        }
    }

    public List<string> GetGroupMessageTemplates(GroupMessageTaskConfig cfg)
    {
        return DeserializeStringList(cfg?.TemplatesJson);
    }

    public List<long> GetGroupMessageTargetChatIds(GroupMessageTaskConfig cfg)
    {
        if (cfg is null || string.IsNullOrWhiteSpace(cfg.TargetChatIdsJson))
            return new List<long>();

        try
        {
            var list = JsonSerializer.Deserialize<List<long>>(cfg.TargetChatIdsJson);
            return NormalizeLongList(list);
        }
        catch
        {
            return new List<long>();
        }
    }

    private static MonitorReplyConfig NormalizeReplyConfig(MonitorReplyConfig cfg)
    {
        cfg.DefaultReplyTemplate = string.IsNullOrWhiteSpace(cfg.DefaultReplyTemplate)
            ? "Received, {sender}, your message matched keywords: {keywords}"
            : cfg.DefaultReplyTemplate.Trim();
        cfg.ReplyTemplatesJson = string.IsNullOrWhiteSpace(cfg.ReplyTemplatesJson) ? "[]" : cfg.ReplyTemplatesJson;
        return cfg;
    }

    private static KeywordConfig NormalizeKeywordConfig(KeywordConfig cfg)
    {
        cfg.KeywordContent ??= string.Empty;

        var routes = DeserializeKeywordTargetRoutes(cfg.TargetRoutesJson);
        if ((routes == null || routes.Count == 0) && cfg.TargetRoutes?.Count > 0)
        {
            routes = NormalizeKeywordTargetRoutes(cfg.TargetRoutes);
        }

        if ((routes == null || routes.Count == 0) && cfg.TargetChatId != 0)
        {
            routes = new List<KeywordTargetRoute>
            {
                new() { TargetChatId = cfg.TargetChatId, IncludeSource = true }
            };
        }

        routes ??= new List<KeywordTargetRoute>();
        if (routes.Count == 0 && cfg.TargetChatId != 0)
        {
            routes.Add(new KeywordTargetRoute
            {
                TargetChatId = cfg.TargetChatId,
                IncludeSource = true,
                ForwardMode = cfg.ForwardMode
            });
        }
        cfg.TargetRoutes = routes;
        cfg.TargetRoutesJson = JsonSerializer.Serialize(routes);
        cfg.TargetChatId = routes.FirstOrDefault()?.TargetChatId ?? 0;
        cfg.ForwardMode = routes.FirstOrDefault()?.ForwardMode ?? cfg.ForwardMode;
        return cfg;
    }

    private static GroupMessageTaskConfig NormalizeGroupTaskConfig(GroupMessageTaskConfig cfg)
    {
        cfg.PerGroupIntervalSeconds = Math.Max(1, cfg.PerGroupIntervalSeconds);
        cfg.MinIntervalSeconds = Math.Max(5, cfg.MinIntervalSeconds);
        cfg.MaxIntervalSeconds = Math.Max(cfg.MinIntervalSeconds, cfg.MaxIntervalSeconds);
        cfg.TemplatesJson = string.IsNullOrWhiteSpace(cfg.TemplatesJson) ? "[]" : cfg.TemplatesJson;
        cfg.TargetChatIdsJson = string.IsNullOrWhiteSpace(cfg.TargetChatIdsJson) ? "[]" : cfg.TargetChatIdsJson;
        return cfg;
    }

    private static UserTelegramSettings NormalizeUserTelegramSettings(UserTelegramSettings settings, int userId)
    {
        settings.UserId = userId;
        settings.MonitorChatIdsJson = string.IsNullOrWhiteSpace(settings.MonitorChatIdsJson) ? "[]" : settings.MonitorChatIdsJson;
        return settings;
    }

    private static List<string> DeserializeStringList(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return new List<string>();

        try
        {
            return NormalizeStringList(JsonSerializer.Deserialize<List<string>>(json));
        }
        catch
        {
            return new List<string>();
        }
    }

    private static List<KeywordTargetRoute> DeserializeKeywordTargetRoutes(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return new List<KeywordTargetRoute>();

        try
        {
            return NormalizeKeywordTargetRoutes(JsonSerializer.Deserialize<List<KeywordTargetRoute>>(json));
        }
        catch
        {
            return new List<KeywordTargetRoute>();
        }
    }

    private static List<string> NormalizeStringList(IEnumerable<string> list)
    {
        if (list == null) return new List<string>();

        return list
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<long> NormalizeLongList(IEnumerable<long> list)
    {
        if (list == null) return new List<long>();

        return list
            .Where(x => x != 0)
            .Distinct()
            .ToList();
    }

    private static List<KeywordTargetRoute> NormalizeKeywordTargetRoutes(IEnumerable<KeywordTargetRoute> routes)
    {
        if (routes == null) return new List<KeywordTargetRoute>();

        return routes
            .Where(route => route != null && route.TargetChatId != 0)
            .GroupBy(route => route.TargetChatId)
            .Select(group => new KeywordTargetRoute
            {
                TargetChatId = group.Key,
                IncludeSource = group.Last().IncludeSource,
                ForwardMode = group.Last().ForwardMode
            })
            .ToList();
    }
}
