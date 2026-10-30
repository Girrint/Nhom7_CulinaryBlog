"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, apiFetch } from "@/lib/api/client";
import type {
  CategoryDto,
  PagedResult,
  RecipeSearchItem,
  RecipeSearchOptions,
} from "@/lib/api/contracts";
import { Pagination, SkeletonCardGrid } from "@/components/shared";
import { highlightMatches } from "./highlight";
import { queryKeys } from "@/lib/query/keys";

const DEFAULT_PAGE_SIZE = 12;
const DEBOUNCE_MS = 350;

function positiveInteger(value: string | null, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) {
      return "Thông tin tìm kiếm chưa hợp lệ. Hãy kiểm tra từ khóa và bộ lọc.";
    }
    if (error.status >= 500) {
      return "Máy chủ đang gặp sự cố. Vui lòng thử lại sau.";
    }
    return error.message;
  }
  return "Không thể kết nối đến máy chủ. Hãy kiểm tra kết nối rồi thử lại.";
}

function makeSearchUrl(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const [draftTerm, setDraftTerm] = useState(searchParams.get("q") ?? "");
  const [lastResponseMs, setLastResponseMs] = useState<number | null>(null);
  const requestNumber = useRef(0);

  const options = useMemo<RecipeSearchOptions>(() => {
    const params = new URLSearchParams(searchParamsString);
    return {
      q: (params.get("q") ?? "").trim(),
      categoryId: params.get("categoryId") ?? "",
      difficulty: params.get("difficulty") ?? "",
      maxCookTime: params.get("maxCookTime") ?? "",
      minServings: params.get("minServings") ?? "",
      sort: params.get("sort") ?? "-createdAt",
      page: positiveInteger(params.get("page"), 1),
      pageSize: positiveInteger(params.get("pageSize"), DEFAULT_PAGE_SIZE),
    };
  }, [searchParamsString]);

  const updateUrl = useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParamsString);
    mutate(params);
    const nextUrl = makeSearchUrl(pathname, params);
    if (nextUrl !== makeSearchUrl(pathname, new URLSearchParams(searchParamsString))) {
      router.push(nextUrl, { scroll: false });
    }
  }, [pathname, router, searchParamsString]);

  useEffect(() => {
    setDraftTerm(options.q);
  }, [options.q]);

  useEffect(() => {
    const nextTerm = draftTerm.trim();
    if (nextTerm === options.q) return;

    const timer = window.setTimeout(() => {
      updateUrl((params) => {
        if (nextTerm) params.set("q", nextTerm);
        else params.delete("q");
        params.delete("page");
        if (!nextTerm && params.get("sort") === "relevance") {
          params.set("sort", "-createdAt");
        }
      });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draftTerm, options.q, updateUrl]);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => apiFetch<CategoryDto[]>("/categories"),
  });

  const recipesQuery = useQuery({
    queryKey: queryKeys.recipes.search(options),
    enabled: options.q.length === 0 || options.q.length >= 2,
    queryFn: async () => {
      const currentRequest = ++requestNumber.current;
      const startedAt = performance.now();
      const params = new URLSearchParams();
      if (options.q) params.set("q", options.q);
      if (options.categoryId) params.set("categoryId", options.categoryId);
      if (options.difficulty) params.set("difficulty", options.difficulty);
      if (options.maxCookTime) params.set("maxCookTime", options.maxCookTime);
      if (options.minServings) params.set("minServings", options.minServings);
      params.set("sort", options.sort);
      params.set("page", String(options.page));
      params.set("pageSize", String(options.pageSize));

      try {
        return await apiFetch<PagedResult<RecipeSearchItem>>(
          `/recipes/search?${params.toString()}`,
        );
      } finally {
        if (currentRequest === requestNumber.current) {
          setLastResponseMs(Math.round(performance.now() - startedAt));
        }
      }
    },
  });

  function changeFilter(key: string, value: string) {
    updateUrl((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
      if (key !== "page") params.delete("page");
      if (key === "q" && !value && params.get("sort") === "relevance") {
        params.set("sort", "-createdAt");
      }
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTerm = draftTerm.trim();
    updateUrl((params) => {
      if (nextTerm) params.set("q", nextTerm);
      else params.delete("q");
      params.delete("page");
      if (!nextTerm && params.get("sort") === "relevance") {
        params.set("sort", "-createdAt");
      }
    });
  }

  function resetSearch() {
    setDraftTerm("");
    router.push(pathname, { scroll: false });
  }

  const result = recipesQuery.data;
  const isShortTerm = options.q.length === 1;
  const isInitialLoading = recipesQuery.isPending && !isShortTerm;
  const selectedCategory = categoriesQuery.data?.find(
    (category) => category.id === options.categoryId,
  );

  return (
    <main className="search-shell ds-scope">
      <header className="search-header">
        <Link className="search-brand" href="/" aria-label="Culinary Blog, trang chủ">
          <span>Culinary Blog</span>
        </Link>
        <Link className="search-home-link" href="/">Trang chủ</Link>
      </header>

      <section className="search-intro" aria-labelledby="search-title">
        <p className="search-kicker">Khám phá căn bếp</p>
        <h1 id="search-title">Tìm món ngon tiếp theo</h1>
        <p className="search-description">
          Tìm theo tên món, nguyên liệu hoặc mô tả. Có thể nhập tiếng Việt có dấu hoặc không dấu.
        </p>

        <form className="search-form" onSubmit={submitSearch} role="search">
          <svg aria-hidden="true" className="search-form-icon" fill="none" height="20" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="20">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <label className="visually-hidden" htmlFor="recipe-search">Từ khóa tìm công thức</label>
          <input
            autoComplete="off"
            id="recipe-search"
            maxLength={200}
            onChange={(event) => setDraftTerm(event.target.value)}
            placeholder="Ví dụ: phở bò, bánh mì..."
            type="search"
            value={draftTerm}
          />
          <button className="search-submit" type="submit">Tìm</button>
        </form>
        {isShortTerm && (
          <p className="search-hint" role="status">Từ khóa cần ít nhất 2 ký tự.</p>
        )}
      </section>

      <section className="search-content" aria-label="Kết quả và bộ lọc tìm kiếm">
        <aside className="search-filters" aria-label="Bộ lọc">
          <div className="filter-heading">
            <h2>Bộ lọc</h2>
            <button className="text-button" onClick={resetSearch} type="button">Xóa tất cả</button>
          </div>

          <label className="filter-field">
            <span>Danh mục</span>
            <select
              onChange={(event) => changeFilter("categoryId", event.target.value)}
              value={options.categoryId}
            >
              <option value="">Tất cả danh mục</option>
              {categoriesQuery.data?.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          {categoriesQuery.isError && (
            <div className="filter-error" role="alert">
              Không tải được danh mục.
              <button className="text-button" onClick={() => void categoriesQuery.refetch()} type="button">
                Thử lại
              </button>
            </div>
          )}

          <label className="filter-field">
            <span>Độ khó</span>
            <select
              onChange={(event) => changeFilter("difficulty", event.target.value)}
              value={options.difficulty}
            >
              <option value="">Mọi độ khó</option>
              <option value="Easy">Dễ</option>
              <option value="Medium">Trung bình</option>
              <option value="Hard">Khó</option>
            </select>
          </label>

          <label className="filter-field">
            <span>Thời gian nấu tối đa (phút)</span>
            <input
              min="0"
              onChange={(event) => changeFilter("maxCookTime", event.target.value)}
              placeholder="Không giới hạn"
              type="number"
              value={options.maxCookTime}
            />
          </label>

          <label className="filter-field">
            <span>Khẩu phần tối thiểu</span>
            <input
              min="1"
              onChange={(event) => changeFilter("minServings", event.target.value)}
              placeholder="Bất kỳ"
              type="number"
              value={options.minServings}
            />
          </label>
        </aside>

        <div className="search-results" aria-live="polite" aria-busy={recipesQuery.isFetching}>
          <div className="results-toolbar">
            <div>
              <h2>Kết quả công thức</h2>
              {result && (
                <p className="results-meta">
                  {result.totalCount.toLocaleString("vi-VN")} công thức
                  {selectedCategory ? ` trong ${selectedCategory.name}` : ""}
                  {lastResponseMs !== null ? ` · ${lastResponseMs} ms` : ""}
                </p>
              )}
            </div>
            <label className="sort-field">
              <span>Sắp xếp</span>
              <select
                onChange={(event) => changeFilter("sort", event.target.value)}
                value={options.sort}
              >
                <option value="-createdAt">Mới nhất</option>
                <option value="title">Tên A–Z</option>
                <option value="-title">Tên Z–A</option>
                <option value="cookTime">Nấu nhanh nhất</option>
                <option value="-cookTime">Nấu lâu nhất</option>
                {options.q.length >= 2 && <option value="-relevance">Liên quan nhất</option>}
              </select>
            </label>
          </div>

          {isInitialLoading && <SkeletonCardGrid cardHeight="8.5rem" count={4} label="Đang tải công thức" minColumnWidth="100%" />}

          {recipesQuery.isError && (
            <div className="search-state search-error" role="alert">
              <span className="state-icon" aria-hidden="true">!</span>
              <h3>Chưa thể tải kết quả</h3>
              <p>{errorMessage(recipesQuery.error)}</p>
              <button className="search-submit" onClick={() => void recipesQuery.refetch()} type="button">
                Thử lại
              </button>
            </div>
          )}

          {!isInitialLoading && !recipesQuery.isError && isShortTerm && (
            <div className="search-state">
              <span className="state-icon" aria-hidden="true">⌕</span>
              <h3>Nhập thêm một chút nhé</h3>
              <p>Từ khóa tìm kiếm cần ít nhất 2 ký tự.</p>
            </div>
          )}

          {!isInitialLoading && !recipesQuery.isError && !isShortTerm && result?.items.length === 0 && (
            <div className="search-state">
              <span className="state-icon" aria-hidden="true">⌕</span>
              <h3>Chưa tìm thấy công thức phù hợp</h3>
              <p>Thử từ khóa khác hoặc bỏ bớt một vài bộ lọc.</p>
              <button className="text-button" onClick={resetSearch} type="button">
                Xóa bộ lọc
              </button>
            </div>
          )}

          {!isInitialLoading && !recipesQuery.isError && result && result.items.length > 0 && (
            <>
              {recipesQuery.isFetching && (
                <p className="updating-indicator" role="status">Đang cập nhật kết quả…</p>
              )}
              <div className="recipe-grid">
                {result.items.map((recipe) => (
                  <Link
                    className="recipe-card"
                    href={`/recipes/${encodeURIComponent(recipe.id)}`}
                    key={recipe.id}
                  >
                    <div className="recipe-card-image" aria-hidden="true" />
                    <div className="recipe-card-body">
                      <span className="recipe-card-category">
                        {categoriesQuery.data?.find((category) => category.id === recipe.categoryId)?.name}
                      </span>
                      <h3>{highlightMatches(recipe.title, options.q)}</h3>
                      <p className="recipe-description">{recipe.description}</p>
                      <span className="recipe-card-meta">
                        {recipe.cookTime} phút · {difficultyLabel(recipe.difficulty)}
                        {recipe.relevanceScore !== null && ` · Độ phù hợp ${recipe.relevanceScore.toFixed(2)}`}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              <Pagination
                label="Phân trang kết quả"
                onPageChange={(page) => changeFilter("page", String(page))}
                page={options.page}
                totalPages={result.totalPages}
              />
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function difficultyLabel(difficulty: RecipeSearchItem["difficulty"]): string {
  switch (difficulty) {
    case "Easy":
      return "Dễ";
    case "Medium":
      return "Trung bình";
    case "Hard":
      return "Khó";
  }
}
