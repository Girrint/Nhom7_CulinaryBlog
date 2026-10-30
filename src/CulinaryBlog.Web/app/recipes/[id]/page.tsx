import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecipeDetail } from "@/components/recipes/recipe-detail";
import {
  createRecipeDetailViewModel,
  createRecipeSeoModel,
  isPublicRecipeDetail,
  isRecipeId,
  isRecipeNotFoundError,
} from "@/lib/recipes/detail";
import { getPublicRecipeDetail } from "@/lib/recipes/server-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isRecipeId(id)) return unavailableMetadata();

  try {
    const detail = await getPublicRecipeDetail(id);
    if (!isPublicRecipeDetail(detail)) return unavailableMetadata();
    const seo = createRecipeSeoModel(detail);
    return {
      title: { absolute: seo.title },
      description: seo.description,
      robots: { index: true, follow: true },
      openGraph: {
        type: "article",
        title: seo.title,
        description: seo.description,
        ...(seo.imageUrl ? { images: [{ url: seo.imageUrl, alt: detail.title }] } : {}),
      },
    };
  } catch {
    return unavailableMetadata();
  }
}

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isRecipeId(id)) notFound();

  let detail;
  try {
    detail = await getPublicRecipeDetail(id);
  } catch (error) {
    if (isRecipeNotFoundError(error)) notFound();
    throw error;
  }

  if (!isPublicRecipeDetail(detail)) notFound();

  const seo = createRecipeSeoModel(detail);
  const safeJsonLd = JSON.stringify(seo.jsonLd).replace(/</g, "\\u003c");

  return (
    <>
      <RecipeDetail recipe={createRecipeDetailViewModel(detail)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd }} />
    </>
  );
}

function unavailableMetadata(): Metadata {
  return {
    title: { absolute: "Không tìm thấy công thức | Culinary Blog" },
    robots: { index: false, follow: false },
  };
}
