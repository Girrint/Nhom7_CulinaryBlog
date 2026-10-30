import "server-only";

import { createRecipeClient } from "./client.ts";
import type { RecipeDetailDto } from "./contracts.ts";
import { recipeServerApiBaseUrl } from "./server-api.ts";

export async function getPublicRecipeDetail(id: string): Promise<RecipeDetailDto> {
  const client = createRecipeClient({
    baseUrl: recipeServerApiBaseUrl(),
    getAccessToken: () => null,
    cache: "no-store",
  });
  const response = await client.detail(id);
  return response.data;
}
