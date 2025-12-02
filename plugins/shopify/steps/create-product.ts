import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { getErrorMessage } from "@/lib/utils";
import type { ShopifyCredentials } from "../credentials";

type ShopifyVariant = {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku?: string;
  inventory_quantity?: number;
  inventory_item_id?: number;
};

type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  status: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags: string;
  created_at: string;
  updated_at: string;
  variants: ShopifyVariant[];
};

type CreateProductResult =
  | {
      success: true;
      id: number;
      title: string;
      handle: string;
      status: string;
      variants: Array<{
        id: number;
        title: string;
        price: string;
        sku?: string;
        inventoryItemId?: number;
      }>;
      createdAt: string;
    }
  | { success: false; error: string };

export type CreateProductCoreInput = {
  title: string;
  bodyHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string;
  status?: string;
  price?: string;
  sku?: string;
  inventoryQuantity?: number;
};

export type CreateProductInput = StepInput &
  CreateProductCoreInput & {
    integrationId?: string;
  };

function normalizeStoreDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function stepHandler(
  input: CreateProductCoreInput,
  credentials: ShopifyCredentials
): Promise<CreateProductResult> {
  const storeDomain = credentials.SHOPIFY_STORE_DOMAIN;
  const accessToken = credentials.SHOPIFY_ACCESS_TOKEN;

  if (!storeDomain) {
    return {
      success: false,
      error:
        "SHOPIFY_STORE_DOMAIN is not configured. Please add it in Project Integrations.",
    };
  }

  if (!accessToken) {
    return {
      success: false,
      error:
        "SHOPIFY_ACCESS_TOKEN is not configured. Please add it in Project Integrations.",
    };
  }

  try {
    const normalizedDomain = normalizeStoreDomain(storeDomain);
    const url = `https://${normalizedDomain}/admin/api/2024-01/products.json`;

    // Build the product payload
    const productPayload: Record<string, unknown> = {
      title: input.title,
    };

    if (input.bodyHtml) {
      productPayload.body_html = input.bodyHtml;
    }

    if (input.vendor) {
      productPayload.vendor = input.vendor;
    }

    if (input.productType) {
      productPayload.product_type = input.productType;
    }

    if (input.tags) {
      productPayload.tags = input.tags;
    }

    if (input.status) {
      productPayload.status = input.status;
    }

    // Add variant with price/sku if provided
    if (input.price || input.sku) {
      const variant: Record<string, unknown> = {};

      if (input.price) {
        variant.price = input.price;
      }

      if (input.sku) {
        variant.sku = input.sku;
      }

      productPayload.variants = [variant];
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ product: productPayload }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { errors?: unknown };
      const errorMessage =
        typeof errorData.errors === "string"
          ? errorData.errors
          : JSON.stringify(errorData.errors);
      return {
        success: false,
        error: errorMessage || `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { product: ShopifyProduct };
    const product = data.product;

    return {
      success: true,
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      variants: product.variants.map((v) => ({
        id: v.id,
        title: v.title,
        price: v.price,
        sku: v.sku,
        inventoryItemId: v.inventory_item_id,
      })),
      createdAt: product.created_at,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create product: ${getErrorMessage(error)}`,
    };
  }
}

export async function createProductStep(
  input: CreateProductInput
): Promise<CreateProductResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}

export const _integrationType = "shopify";
