import { ApiError } from "../api/client.ts";
import type { ApiProblemDetails } from "../api/contracts.ts";
import { authStore } from "../auth/auth-store.ts";
import type {
  CreateRecipeRequest,
  CreatedResource,
  RecipeApiResponse,
  RecipeDetailDto,
  RecipeDifficulty,
  RecipeImageDto,
  RecipeIngredientDto,
  RecipeIngredientRequest,
  RecipeListFilters,
  RecipeListItemDto,
  RecipeStatus,
  RecipeStepDto,
  RecipeStepRequest,
  UpdateRecipeRequest,
} from "./contracts.ts";

export interface RecipeClientOptions {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  fetchImplementation?: typeof fetch;
  cache?: RequestCache;
}

type RequestOptions = RequestInit & { eTag?: string };

const difficultyByValue: Record<number, RecipeDifficulty> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
};

const statusByValue: Record<number, RecipeStatus> = {
  0: "Draft",
  1: "Published",
  2: "Archived",
};

const difficultyValue: Record<RecipeDifficulty, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
};

function normalizeDifficulty(value: RecipeDifficulty | number): RecipeDifficulty {
  return typeof value === "number" ? difficultyByValue[value] : value;
}

function normalizeStatus(value: RecipeStatus | number): RecipeStatus {
  return typeof value === "number" ? statusByValue[value] : value;
}

function normalizeRecipeListItem(item: RecipeListItemDto): RecipeListItemDto {
  return {
    ...item,
    difficulty: normalizeDifficulty(item.difficulty),
    status: normalizeStatus(item.status),
  };
}

function normalizeRecipeDetail(detail: RecipeDetailDto): RecipeDetailDto {
  return {
    ...detail,
    difficulty: normalizeDifficulty(detail.difficulty),
    status: normalizeStatus(detail.status),
  };
}

function encodeRecipeRequest<T extends CreateRecipeRequest | UpdateRecipeRequest>(request: T) {
  return {
    ...request,
    difficulty: difficultyValue[request.difficulty],
  };
}

export interface RecipeClient {
  list(filters?: RecipeListFilters): Promise<RecipeApiResponse<RecipeListItemDto[]>>;
  detail(id: string): Promise<RecipeApiResponse<RecipeDetailDto>>;
  create(request: CreateRecipeRequest): Promise<RecipeApiResponse<CreatedResource>>;
  update(id: string, request: UpdateRecipeRequest, eTag: string): Promise<RecipeApiResponse<RecipeDetailDto>>;
  publish(id: string, eTag: string): Promise<RecipeApiResponse<RecipeDetailDto>>;
  unpublish(id: string, eTag: string): Promise<RecipeApiResponse<RecipeDetailDto>>;
  archive(id: string, eTag: string): Promise<RecipeApiResponse<RecipeDetailDto>>;
  delete(id: string, eTag: string): Promise<RecipeApiResponse<void>>;
  createIngredient(id: string, request: RecipeIngredientRequest, eTag: string): Promise<RecipeApiResponse<CreatedResource>>;
  updateIngredient(id: string, ingredientId: string, request: RecipeIngredientRequest, eTag: string): Promise<RecipeApiResponse<RecipeIngredientDto>>;
  deleteIngredient(id: string, ingredientId: string, eTag: string): Promise<RecipeApiResponse<void>>;
  createStep(id: string, request: RecipeStepRequest, eTag: string): Promise<RecipeApiResponse<CreatedResource>>;
  updateStep(id: string, stepId: string, request: RecipeStepRequest, eTag: string): Promise<RecipeApiResponse<RecipeStepDto>>;
  deleteStep(id: string, stepId: string, eTag: string): Promise<RecipeApiResponse<void>>;
  uploadImage(id: string, file: Blob, fileName: string, altText: string | null, isPrimary: boolean, eTag: string): Promise<RecipeApiResponse<RecipeImageDto>>;
  setPrimaryImage(id: string, imageId: string, eTag: string): Promise<RecipeApiResponse<RecipeImageDto>>;
  deleteImage(id: string, imageId: string, eTag: string): Promise<RecipeApiResponse<void>>;
}

export function responseEtag(headers: Headers): string | null {
  return headers.get("ETag");
}

export function createRecipeClient(options: RecipeClientOptions = {}): RecipeClient {
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
  const getAccessToken = options.getAccessToken ?? (() => authStore.getAccessToken());
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;

  async function request<T>(path: string, options: RequestOptions = {}): Promise<RecipeApiResponse<T>> {
    const { eTag, ...requestInit } = options;
    const headers = new Headers(requestInit.headers);
    const token = getAccessToken();

    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (requestInit.body && !(requestInit.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    if (eTag) headers.set("If-Match", eTag);

    const response = await fetchImplementation(`${baseUrl}${path}`, {
      ...requestInit,
      headers,
      credentials: "include",
      cache: requestInit.cache ?? options.cache ?? "no-store",
    });

    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as ApiProblemDetails;
      throw new ApiError(response.status, problem);
    }

    const data = response.status === 204
      ? undefined as T
      : await response.json() as T;

    return { data, eTag: responseEtag(response.headers) };
  }

  const jsonMutation = <T>(method: string, path: string, body: unknown, eTag?: string) =>
    request<T>(path, {
      method,
      body: JSON.stringify(body),
      eTag,
    });

  const eTagMutation = <T>(method: string, path: string, eTag: string) =>
    request<T>(path, { method, eTag });

  return {
    async list(filters = {}) {
      const search = new URLSearchParams();
      if (filters.categoryId) search.set("categoryId", filters.categoryId);
      if (filters.difficulty) search.set("difficulty", filters.difficulty);
      if (filters.status) search.set("status", filters.status);
      const query = search.toString();
      const response = await request<RecipeListItemDto[]>(`/recipes${query ? `?${query}` : ""}`);
      return { ...response, data: response.data.map(normalizeRecipeListItem) };
    },
    async detail(id) {
      const response = await request<RecipeDetailDto>(`/recipes/${encodeURIComponent(id)}`);
      return { ...response, data: normalizeRecipeDetail(response.data) };
    },
    create: (body) => jsonMutation<CreatedResource>("POST", "/recipes", encodeRecipeRequest(body)),
    async update(id, body, eTag) {
      const response = await jsonMutation<RecipeDetailDto>(
        "PUT",
        `/recipes/${encodeURIComponent(id)}`,
        encodeRecipeRequest(body),
        eTag,
      );
      return { ...response, data: normalizeRecipeDetail(response.data) };
    },
    async publish(id, eTag) {
      const response = await eTagMutation<RecipeDetailDto>("PATCH", `/recipes/${encodeURIComponent(id)}/publish`, eTag);
      return { ...response, data: normalizeRecipeDetail(response.data) };
    },
    async unpublish(id, eTag) {
      const response = await eTagMutation<RecipeDetailDto>("PATCH", `/recipes/${encodeURIComponent(id)}/unpublish`, eTag);
      return { ...response, data: normalizeRecipeDetail(response.data) };
    },
    async archive(id, eTag) {
      const response = await eTagMutation<RecipeDetailDto>("PATCH", `/recipes/${encodeURIComponent(id)}/archive`, eTag);
      return { ...response, data: normalizeRecipeDetail(response.data) };
    },
    delete: (id, eTag) => eTagMutation<void>("DELETE", `/recipes/${encodeURIComponent(id)}`, eTag),
    createIngredient: (id, body, eTag) => jsonMutation<CreatedResource>("POST", `/recipes/${encodeURIComponent(id)}/ingredients`, body, eTag),
    updateIngredient: (id, ingredientId, body, eTag) => jsonMutation<RecipeIngredientDto>("PUT", `/recipes/${encodeURIComponent(id)}/ingredients/${encodeURIComponent(ingredientId)}`, body, eTag),
    deleteIngredient: (id, ingredientId, eTag) => eTagMutation<void>("DELETE", `/recipes/${encodeURIComponent(id)}/ingredients/${encodeURIComponent(ingredientId)}`, eTag),
    createStep: (id, body, eTag) => jsonMutation<CreatedResource>("POST", `/recipes/${encodeURIComponent(id)}/steps`, body, eTag),
    updateStep: (id, stepId, body, eTag) => jsonMutation<RecipeStepDto>("PUT", `/recipes/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}`, body, eTag),
    deleteStep: (id, stepId, eTag) => eTagMutation<void>("DELETE", `/recipes/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}`, eTag),
    uploadImage(id, file, fileName, altText, isPrimary, eTag) {
      const formData = new FormData();
      formData.append("file", file, fileName);
      if (altText) formData.append("altText", altText);
      formData.append("isPrimary", String(isPrimary));
      return request<RecipeImageDto>(`/recipes/${encodeURIComponent(id)}/images`, {
        method: "POST",
        body: formData,
        eTag,
      });
    },
    setPrimaryImage: (id, imageId, eTag) => eTagMutation<RecipeImageDto>("PATCH", `/recipes/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}/primary`, eTag),
    deleteImage: (id, imageId, eTag) => eTagMutation<void>("DELETE", `/recipes/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`, eTag),
  };
}

export const recipeClient = createRecipeClient();
