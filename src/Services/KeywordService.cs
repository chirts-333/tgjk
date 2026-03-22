namespace TelegramMonitor;

public sealed class KeywordService : IDynamicApiController, ITransient
{
    private readonly SystemCacheServices _cache;
    private readonly ICurrentUserAccessor _currentUser;

    public KeywordService(SystemCacheServices cache, ICurrentUserAccessor currentUser)
    {
        _cache = cache;
        _currentUser = currentUser;
    }

    [ApiDescriptionSettings(Name = "List", Description = "关键词列表", Order = 10)]
    [HttpGet, DisplayName("关键词列表")]
    public async Task<IReadOnlyList<KeywordConfig>> ListAsync()
        => await _cache.GetKeywordsAsync(_currentUser.UserId);

    [ApiDescriptionSettings(Name = "Add", Description = "添加关键词", Order = 8)]
    [HttpPost, DisplayName("添加关键词")]
    public async Task AddAsync([FromBody] KeywordConfig keyword)
        => await _cache.AddKeywordsAsync(_currentUser.UserId, keyword);

    [ApiDescriptionSettings(Name = "BatchAdd", Description = "批量添加关键词", Order = 7)]
    [HttpPost, DisplayName("批量添加关键词")]
    public async Task BatchAddAsync([FromBody] List<KeywordConfig> keywords)
        => await _cache.BatchAddKeywordsAsync(_currentUser.UserId, keywords);

    [ApiDescriptionSettings(Name = "Update", Description = "更新关键词", Order = 6)]
    [HttpPut, DisplayName("更新关键词")]
    public async Task UpdateAsync([FromBody] KeywordConfig keyword)
        => await _cache.UpdateKeywordsAsync(_currentUser.UserId, keyword);

    [ApiDescriptionSettings(Name = "Delete", Description = "删除关键词", Order = 5)]
    [HttpDelete, DisplayName("删除关键词")]
    public async Task DeleteAsync(int id)
        => await _cache.DeleteKeywordsAsync(_currentUser.UserId, id);

    [HttpPost("remove")]
    public async Task RemoveAsync([FromBody] DeleteKeywordRequest request)
        => await _cache.DeleteKeywordsAsync(_currentUser.UserId, request.Id);

    [ApiDescriptionSettings(Name = "BatchDelete", Description = "批量删除关键词", Order = 4)]
    [HttpDelete, DisplayName("批量删除关键词")]
    public async Task BatchDeleteAsync([FromBody] IEnumerable<int> ids)
        => await _cache.BatchDeleteKeywordsAsync(_currentUser.UserId, ids.ToList());
}

public sealed record DeleteKeywordRequest(int Id);
