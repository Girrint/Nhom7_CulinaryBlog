import "server-only";

import { ApiError } from "../api/client.ts";
import type { ApiProblemDetails, CategoryDto } from "../api/contracts.ts";
import { createRecipeClient } from "./client.ts";
import type { RecipeListFilters, RecipeListItemDto } from "./contracts.ts";
import { recipeServerApiBaseUrl } from "./server-api.ts";

export interface RecipeListData {
  recipes: RecipeListItemDto[];
  categories: CategoryDto[];
}

async function getCategories(baseUrl: string): Promise<CategoryDto[]> {
  const response = await fetch(`${baseUrl}/categories`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ApiProblemDetails;
    throw new ApiError(response.status, problem);
  }

  return response.json() as Promise<CategoryDto[]>;
}

export async function getPublicCategories(): Promise<CategoryDto[]> {
  return getCategories(recipeServerApiBaseUrl());
}

export async function getPublicRecipeList(filters: RecipeListFilters): Promise<RecipeListData> {
  const baseUrl = recipeServerApiBaseUrl();
  const client = createRecipeClient({
    baseUrl,
    getAccessToken: () => null,
  });
  const [recipeResponse, categories] = await Promise.all([
    client.list(filters),
    getCategories(baseUrl),
  ]);

  return { recipes: recipeResponse.data, categories };
}
