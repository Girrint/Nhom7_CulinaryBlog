using CulinaryBlog.Domain.Recipes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace CulinaryBlog.Integration.Tests;

public sealed class RecipeForeignKeyMigrationTests
{
    private const string PreviousMigration = "20261014143221_AddJobExecutionStore";

    [Fact]
    public async Task UpgradePreservesValidRecipesAndEnforcesAuthorAndCategoryReferences()
    {
        await using var database = await PostgresTestDatabase.CreateAsync(
            PreviousMigration,
            "recipe_foreign_keys");
        await using var context = database.CreateContext();
        var references = await RecipeIntegrationTestData.CreateReferencesAsync(
            context,
            RecipeIntegrationTestData.CreateAuthorId());
        var recipe = CreateRecipe(references.CategoryId, references.AuthorId, "upgrade-valid");
        context.Recipes.Add(recipe);
        await context.SaveChangesAsync();

        await context.GetService<IMigrator>().MigrateAsync();
        context.ChangeTracker.Clear();

        Assert.NotNull(await context.Recipes.FindAsync(recipe.Id));
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());

        context.Recipes.Add(CreateRecipe(references.CategoryId, "missing-author", "missing-author"));
        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        context.ChangeTracker.Clear();

        context.Recipes.Add(CreateRecipe(Guid.NewGuid(), references.AuthorId, "missing-category"));
        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task RemovingOnlyOrphanRecipesMakesTheLegacyDatabaseUpgradeable()
    {
        await using var database = await PostgresTestDatabase.CreateAsync(
            PreviousMigration,
            "recipe_foreign_keys");
        await using var context = database.CreateContext();
        var references = await RecipeIntegrationTestData.CreateReferencesAsync(
            context,
            RecipeIntegrationTestData.CreateAuthorId());
        var validRecipe = CreateRecipe(references.CategoryId, references.AuthorId, "cleanup-valid");
        var orphanRecipe = CreateRecipe(Guid.NewGuid(), "integration-test-author", "cleanup-orphan");
        context.Recipes.AddRange(validRecipe, orphanRecipe);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var removed = await context.Database.ExecuteSqlRawAsync("""
            DELETE FROM "Recipes" AS recipe
            WHERE NOT EXISTS (
                SELECT 1 FROM "AspNetUsers" AS author
                WHERE author."Id" = recipe."AuthorId")
              OR NOT EXISTS (
                SELECT 1 FROM "Categories" AS category
                WHERE category."Id" = recipe."CategoryId");
            """);

        Assert.Equal(1, removed);
        await context.GetService<IMigrator>().MigrateAsync();
        context.ChangeTracker.Clear();

        Assert.NotNull(await context.Recipes.FindAsync(validRecipe.Id));
        Assert.Null(await context.Recipes.FindAsync(orphanRecipe.Id));
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
    }

    private static Recipe CreateRecipe(Guid categoryId, string authorId, string slugPrefix) =>
        Recipe.Create(
            "Recipe foreign-key migration test",
            $"{slugPrefix}-{Guid.NewGuid():N}",
            "Verifies the Recipe foreign-key upgrade path.",
            categoryId,
            authorId,
            5,
            10,
            2,
            RecipeDifficulty.Easy);
}
