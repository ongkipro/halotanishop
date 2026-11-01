export type ProductVariant = {
  catalogId?: number;
  sku?: string;
  id: string;
  label: string;
  price: number;
  comparePrice?: number;
};

export type ProductReview = {
  name: string;
  location: string;
  avatar: string;
  verified: boolean;
  date: string;
  comment: string;
  rating: number;
};

export type Product = {
  catalogId?: number;
  slug: string;
  productId: string;
  productName: string;
  contentName: string;
  headline: string;
  subheadline: string;
  seoTitle: string;
  seoDescription: string;
  price: number;
  /** Merchant-set strike-through price. Absent when the merchant has not set one. */
  comparePrice?: number;
  image: string;
  heroImage: string;
  images?: string[];
  tag?: string;
  category: string;
  /** The manufacturer's brand from `products.brand`; absent when unset. */
  brand?: string;
  relatedCategories: string[];
  relatedTags?: string[];
  description: string;
  /** `products.description` as the merchant wrote it; absent when unset. Feeds prefer it. */
  catalogDescription?: string;
  /** Google product taxonomy id chosen in admin; the feeds send it verbatim. */
  googleCategoryId?: number;
  googleCategoryPath?: string;
  benefits: string[];
  keyPoints: string[];
  idealFor: string[];
  offerText: string;
  ctaText: string;
  ratingValue?: number;
  reviewCount?: number;
  soldCount?: number;
  reviews: ProductReview[];
  variants: ProductVariant[];
};
