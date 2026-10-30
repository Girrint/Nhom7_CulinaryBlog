import type { Metadata } from "next";
import Link from "next/link";
import { Alert, SiteHeader } from "@/components/shared";
import { getPublicCategories } from "@/lib/recipes/server-list";
import "./categories.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Danh mục",
  description: "Khám phá công thức theo từng danh mục món ăn.",
};

export default async function CategoriesPage() {
  try {
    const categories = (await getPublicCategories())
      .sort((left, right) => left.orderIndex - right.orderIndex || left.name.localeCompare(right.name, "vi"));

    return (
      <div className="categories-page ds-scope">
        <SiteHeader />
        <main className="categories-main">
          <header className="categories-heading">
            <p>Khám phá theo chủ đề</p>
            <h1>Danh mục món ăn</h1>
            <span>Chọn một danh mục để xem các công thức đã xuất bản.</span>
          </header>

          {categories.length === 0 ? (
            <Alert variant="info" title="Chưa có danh mục">
              Danh mục món ăn sẽ xuất hiện tại đây sau khi được tạo.
            </Alert>
          ) : (
            <section className="category-grid" aria-label="Danh sách danh mục">
              {categories.map((category) => (
                <Link
                  className="category-card"
                  href={`/recipes?categoryId=${encodeURIComponent(category.id)}`}
                  key={category.id}
                >
                  <span className="category-card-mark" aria-hidden="true">
                    {category.name.trim().charAt(0).toLocaleUpperCase("vi")}
                  </span>
                  <span className="category-card-content">
                    <strong>{category.name}</strong>
                    <span>{category.description?.trim() || "Khám phá các công thức trong danh mục này."}</span>
                    <small>{category.recipeCount.toLocaleString("vi-VN")} công thức</small>
                  </span>
                  <span className="category-card-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </section>
          )}
        </main>
      </div>
    );
  } catch {
    return (
      <div className="categories-page ds-scope">
        <SiteHeader />
        <main className="categories-main">
          <header className="categories-heading">
            <p>Khám phá theo chủ đề</p>
            <h1>Danh mục món ăn</h1>
          </header>
          <Alert
            variant="error"
            title="Không tải được danh mục"
            action={<Link className="categories-retry" href="/categories">Thử lại</Link>}
          >
            Dịch vụ danh mục đang tạm thời không phản hồi.
          </Alert>
        </main>
      </div>
    );
  }
}
