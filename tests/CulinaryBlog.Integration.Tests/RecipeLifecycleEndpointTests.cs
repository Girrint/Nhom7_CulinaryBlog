using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CulinaryBlog.API.Endpoints;
using CulinaryBlog.Application.Recipes.Queries.GetRecipeDetail;
using CulinaryBlog.Domain.Recipes;
using CulinaryBlog.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CulinaryBlog.Integration.Tests;

public sealed class RecipeLifecycleEndpointTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;
    private readonly HttpClient _client;
    private readonly string _authorId = RecipeIntegrationTestData.CreateAuthorId();

    public RecipeLifecycleEndpointTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        _client.DefaultRequestHeaders.Add("X-Test-User", _authorId);
    }

    [Fact]
    public async Task UpdateRequiresEtagReturnsNewEtagAndRejectsStaleVersion()
    {
        var recipeId = await CreateDraftAsync();
        var initial = await GetDetailAsync(recipeId);
        var initialEtag = initial.Response.Headers.GetValues("ETag").Single();
        var body = new UpdateRecipeRequest(
            "Updated lifecycle recipe",
            $"updated-lifecycle-recipe-{Guid.NewGuid():N}",
            "Updated description.",
            initial.Detail.CategoryId,
            initial.Detail.PrepTimeMinutes,
            initial.Detail.CookTimeMinutes,
            initial.Detail.Servings,
            initial.Detail.Difficulty,
            null,
            null,
            null,
            null);

        var missingPrecondition = await _client.PutAsJsonAsync($"/api/v1/recipes/{recipeId}", body);
        var updated = await SendMutationAsync(HttpMethod.Put, $"/api/v1/recipes/{recipeId}", body, initialEtag);
        var staleBody = body with { Title = "Stale lifecycle update" };
        var stale = await SendMutationAsync(HttpMethod.Put, $"/api/v1/recipes/{recipeId}", staleBody, initialEtag);

        Assert.Equal((HttpStatusCode)StatusCodes.Status428PreconditionRequired, missingPrecondition.StatusCode);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.NotEqual(initialEtag, updated.Headers.GetValues("ETag").Single());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, stale.StatusCode);
        using var problem = JsonDocument.Parse(await stale.Content.ReadAsStringAsync());
        Assert.Equal("RECIPE_CONCURRENCY_CONFLICT", problem.RootElement.GetProperty("type").GetString());
    }

    [Fact]
    public async Task ConcurrentUpdateRequestsWithSameEtagAllowExactlyOneWriter()
    {
        var recipeId = await CreateDraftAsync();
        var initial = await GetDetailAsync(recipeId);
        var etag = initial.Response.Headers.GetValues("ETag").Single();
        var firstBody = CreateUpdateRequest(initial.Detail, "Concurrent winner A");
        var secondBody = CreateUpdateRequest(initial.Detail, "Concurrent winner B");
        using var firstRequest = CreateMutationRequest(
            HttpMethod.Put,
            $"/api/v1/recipes/{recipeId}",
            firstBody,
            etag);
        using var secondRequest = CreateMutationRequest(
            HttpMethod.Put,
            $"/api/v1/recipes/{recipeId}",
            secondBody,
            etag);

        var responses = await Task.WhenAll(
            _client.SendAsync(firstRequest),
            _client.SendAsync(secondRequest));
        try
        {
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
            var conflict = Assert.Single(
                responses,
                response => response.StatusCode == HttpStatusCode.UnprocessableEntity);
            using var problem = JsonDocument.Parse(await conflict.Content.ReadAsStringAsync());
            Assert.Equal("RECIPE_CONCURRENCY_CONFLICT", problem.RootElement.GetProperty("type").GetString());

            var persisted = await GetDetailAsync(recipeId);
            Assert.True(persisted.Detail.Title is "Concurrent winner A" or "Concurrent winner B");
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task LifecycleEnforcesPublishRequirementsAndSoftDeletesWithoutRemovingChildren()
    {
        var recipeId = await CreateDraftAsync();
        var initial = await GetDetailAsync(recipeId);
        var incompletePublish = await SendMutationAsync(
            HttpMethod.Patch,
            $"/api/v1/recipes/{recipeId}/publish",
            content: null,
            initial.Response.Headers.GetValues("ETag").Single());

        Assert.Equal(HttpStatusCode.UnprocessableEntity, incompletePublish.StatusCode);
        using (var problem = JsonDocument.Parse(await incompletePublish.Content.ReadAsStringAsync()))
        {
            Assert.Equal("RECIPE_PUBLISH_INCOMPLETE", problem.RootElement.GetProperty("type").GetString());
        }

        await AddPublishRequirementsAsync(recipeId);
        var ready = await GetDetailAsync(recipeId);
        var published = await SendMutationAsync(
            HttpMethod.Patch,
            $"/api/v1/recipes/{recipeId}/publish",
            content: null,
            ready.Response.Headers.GetValues("ETag").Single());
        var publishedDetail = await published.Content.ReadFromJsonAsync<RecipeDetailDto>();

        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
        Assert.NotNull(publishedDetail);
        Assert.Equal(RecipeStatus.Published, publishedDetail.Status);
        Assert.NotNull(publishedDetail.PublishedAt);

        var unpublish = await SendMutationAsync(
            HttpMethod.Patch,
            $"/api/v1/recipes/{recipeId}/unpublish",
            content: null,
            published.Headers.GetValues("ETag").Single());
        var draftDetail = await unpublish.Content.ReadFromJsonAsync<RecipeDetailDto>();
        Assert.Equal(HttpStatusCode.OK, unpublish.StatusCode);
        Assert.NotNull(draftDetail);
        Assert.Equal(RecipeStatus.Draft, draftDetail.Status);
        Assert.Null(draftDetail.PublishedAt);

        var archive = await SendMutationAsync(
            HttpMethod.Patch,
            $"/api/v1/recipes/{recipeId}/archive",
            content: null,
            unpublish.Headers.GetValues("ETag").Single());
        var archivedDetail = await archive.Content.ReadFromJsonAsync<RecipeDetailDto>();
        Assert.Equal(HttpStatusCode.OK, archive.StatusCode);
        Assert.NotNull(archivedDetail);
        Assert.Equal(RecipeStatus.Archived, archivedDetail.Status);

        var delete = await SendMutationAsync(
            HttpMethod.Delete,
            $"/api/v1/recipes/{recipeId}",
            content: null,
            archive.Headers.GetValues("ETag").Single());
        var hiddenDetail = await _client.GetAsync($"/api/v1/recipes/{recipeId}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, hiddenDetail.StatusCode);

        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var deletedRecipe = await dbContext.Recipes
            .IgnoreQueryFilters()
            .SingleAsync(recipe => recipe.Id == recipeId);
        Assert.True(deletedRecipe.IsDeleted);
        Assert.True(await dbContext.RecipeSteps.AnyAsync(step => EF.Property<Guid>(step, "RecipeId") == recipeId));
        Assert.True(await dbContext.RecipeIngredients.AnyAsync(ingredient => EF.Property<Guid>(ingredient, "RecipeId") == recipeId));
    }

    [Fact]
    public async Task OnlyOwnerOrAdminCanUpdateRecipe()
    {
        var recipeId = await CreateDraftAsync();
        var detail = await GetDetailAsync(recipeId);
        var etag = detail.Response.Headers.GetValues("ETag").Single();
        var body = new UpdateRecipeRequest(
            "Authorization check recipe",
            $"authorization-check-{Guid.NewGuid():N}",
            "Updated description.",
            detail.Detail.CategoryId,
            detail.Detail.PrepTimeMinutes,
            detail.Detail.CookTimeMinutes,
            detail.Detail.Servings,
            detail.Detail.Difficulty,
            null,
            null,
            null,
            null);

        using var otherAuthorRequest = CreateMutationRequest(
            HttpMethod.Put,
            $"/api/v1/recipes/{recipeId}",
            body,
            etag);
        otherAuthorRequest.Headers.Add("X-Test-User", "different-author");
        var forbidden = await _client.SendAsync(otherAuthorRequest);

        using var adminRequest = CreateMutationRequest(
            HttpMethod.Put,
            $"/api/v1/recipes/{recipeId}",
            body,
            etag);
        adminRequest.Headers.Add("X-Test-User", "site-admin");
        adminRequest.Headers.Add("X-Test-Role", "Admin");
        var adminUpdate = await _client.SendAsync(adminRequest);

        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.Equal(HttpStatusCode.OK, adminUpdate.StatusCode);
    }

    private async Task<Guid> CreateDraftAsync()
    {
        var references = await RecipeIntegrationTestData.CreateReferencesAsync(
            _factory.Services,
            _authorId);
        var response = await _client.PostAsJsonAsync(
            "/api/v1/recipes",
            new CreateRecipeRequest(
                "Lifecycle test recipe",
                $"lifecycle-test-{Guid.NewGuid():N}",
                "Recipe used by lifecycle integration tests.",
                references.CategoryId,
                5,
                15,
                2,
                RecipeDifficulty.Easy));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return payload.RootElement.GetProperty("id").GetGuid();
    }

    private async Task<(HttpResponseMessage Response, RecipeDetailDto Detail)> GetDetailAsync(Guid recipeId)
    {
        var response = await _client.GetAsync($"/api/v1/recipes/{recipeId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.Contains("ETag"));
        var detail = await response.Content.ReadFromJsonAsync<RecipeDetailDto>();
        Assert.NotNull(detail);
        return (response, detail);
    }

    private async Task AddPublishRequirementsAsync(Guid recipeId)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var recipe = await dbContext.Recipes.SingleAsync(item => item.Id == recipeId);
        var step = recipe.AddStep("Prepare and cook the recipe.");
        var ingredient = recipe.AddIngredient("Ingredient", 1, "piece");
        dbContext.Entry(step).State = EntityState.Added;
        dbContext.Entry(ingredient).State = EntityState.Added;
        await dbContext.SaveChangesAsync();
    }

    private static UpdateRecipeRequest CreateUpdateRequest(RecipeDetailDto detail, string title) => new(
        title,
        $"{title.ToLowerInvariant().Replace(' ', '-')}-{Guid.NewGuid():N}",
        detail.Description,
        detail.CategoryId,
        detail.PrepTimeMinutes,
        detail.CookTimeMinutes,
        detail.Servings,
        detail.Difficulty,
        null,
        null,
        null,
        null);

    private async Task<HttpResponseMessage> SendMutationAsync(
        HttpMethod method,
        string path,
        object? content,
        string etag)
    {
        using var request = CreateMutationRequest(method, path, content, etag);
        return await _client.SendAsync(request);
    }

    private static HttpRequestMessage CreateMutationRequest(
        HttpMethod method,
        string path,
        object? content,
        string etag)
    {
        var request = new HttpRequestMessage(method, path);
        if (content is not null)
        {
            request.Content = JsonContent.Create(content);
        }

        request.Headers.TryAddWithoutValidation("If-Match", etag);
        return request;
    }
}
