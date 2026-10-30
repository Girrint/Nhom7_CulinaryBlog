using CulinaryBlog.Domain.Users;
using CulinaryBlog.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace CulinaryBlog.Integration.Tests.Auth;

public sealed class IdentityMigrationTests
{
    [Theory]
    [InlineData("0")]
    [InlineData("20260920041340_InitialArchitecture")]
    public async Task IdentityMigrationAppliesToCleanAndPreIdentityDatabaseAndCanBeReapplied(string baseline)
    {
        await using var database = await PostgresTestDatabase.CreateAsync(baseline, "identity_migration");
        await using var context = database.CreateContext();
        var migrator = context.GetService<IMigrator>();
        const string identityMigration = "20260920152509_AddIdentityAndRefreshTokens";

        await migrator.MigrateAsync(identityMigration);
        await InsertIdentityAsync(context);
        await AssertIdentityAsync(context);

        context.ChangeTracker.Clear();
        await migrator.MigrateAsync("20260920041340_InitialArchitecture");
        await migrator.MigrateAsync(identityMigration);
        Assert.Empty(await context.Users.ToListAsync());
        Assert.Empty(await context.RefreshTokens.ToListAsync());
        await InsertIdentityAsync(context);
        await AssertIdentityAsync(context);
    }

    [Theory]
    [InlineData("20260920152509_AddIdentityAndRefreshTokens")]
    [InlineData("20261014143221_AddJobExecutionStore")]
    public async Task LaterMigrationsPreserveIdentityPasswordRolesProfileAndRefreshState(string baseline)
    {
        // Includes both the original Identity schema and the last Week 06 migration.
        await using var database = await PostgresTestDatabase.CreateAsync(baseline, "identity_migration");
        await using var context = database.CreateContext();
        await InsertIdentityAsync(context);
        await context.Database.MigrateAsync();
        context.ChangeTracker.Clear();

        await AssertIdentityAsync(context);
        Assert.Empty(await context.Database.GetPendingMigrationsAsync());
        Assert.False(context.Database.HasPendingModelChanges());
    }

    [Fact]
    public async Task FullMigrationChainFromEmptyDatabaseSupportsIdentityConstraintsAndUserCascadeDelete()
    {
        await using var database = await PostgresTestDatabase.CreateAsync(schemaPrefix: "identity_migration");
        await using var context = database.CreateContext();
        await InsertIdentityAsync(context);
        await AssertIdentityAsync(context);

        context.RefreshTokens.Add(RefreshToken.Create("migration-user", "hash-migration", DateTimeOffset.UtcNow.AddDays(1), DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
        context.ChangeTracker.Clear();

        context.Users.Remove(await context.Users.SingleAsync());
        await context.SaveChangesAsync();
        Assert.Empty(await context.RefreshTokens.ToListAsync());
        Assert.Empty(await context.UserRoles.ToListAsync());
        Assert.False(context.Database.HasPendingModelChanges());
    }

    private static async Task InsertIdentityAsync(CulinaryBlog.Infrastructure.Persistence.ApplicationDbContext context)
    {
        var user = new ApplicationUser
        {
            Id = "migration-user",
            UserName = "migration@example.test",
            NormalizedUserName = "MIGRATION@EXAMPLE.TEST",
            Email = "migration@example.test",
            NormalizedEmail = "MIGRATION@EXAMPLE.TEST",
            DisplayName = "Migration Chef",
            Bio = "Existing profile",
            LockoutEnabled = true,
            AccessFailedCount = 2,
        };
        user.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(user, "Migration-Only-1!");
        context.Users.Add(user);
        context.Roles.Add(new IdentityRole { Id = "migration-role", Name = "Author", NormalizedName = "AUTHOR" });
        context.UserRoles.Add(new IdentityUserRole<string> { UserId = user.Id, RoleId = "migration-role" });
        var token = RefreshToken.Create(user.Id, "hash-migration", DateTimeOffset.UtcNow.AddDays(1), DateTimeOffset.UtcNow);
        token.Revoke(DateTimeOffset.UtcNow, "replacement-hash");
        context.RefreshTokens.Add(token);
        await context.SaveChangesAsync();
    }

    private static async Task AssertIdentityAsync(CulinaryBlog.Infrastructure.Persistence.ApplicationDbContext context)
    {
        var user = await context.Users.SingleAsync();
        Assert.Equal("Migration Chef", user.DisplayName);
        Assert.Equal("Existing profile", user.Bio);
        Assert.Equal(2, user.AccessFailedCount);
        Assert.True(user.LockoutEnabled);
        Assert.NotEqual(PasswordVerificationResult.Failed,
            new PasswordHasher<ApplicationUser>().VerifyHashedPassword(user, user.PasswordHash!, "Migration-Only-1!"));
        Assert.Equal("Author", (await context.Roles.SingleAsync()).Name);
        Assert.Equal(user.Id, (await context.UserRoles.SingleAsync()).UserId);
        var token = await context.RefreshTokens.SingleAsync();
        Assert.True(token.IsRevoked);
        Assert.Equal("replacement-hash", token.ReplacedByTokenHash);
    }
}
