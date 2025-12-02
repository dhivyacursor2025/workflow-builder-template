import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { getErrorMessage } from "@/lib/utils";
import type { ShopifyCredentials } from "../credentials";

type ShopifyLineItem = {
  id: number;
  title: string;
  quantity: number;
  price: string;
  sku?: string;
  variant_id?: number;
  product_id?: number;
};

type ShopifyAddress = {
  first_name?: string;
  last_name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
  phone?: string;
};

type ShopifyCustomer = {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
};

type ShopifyOrder = {
  id: number;
  order_number: number;
  name: string;
  email?: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
  updated_at: string;
  line_items: ShopifyLineItem[];
  shipping_address?: ShopifyAddress;
  customer?: ShopifyCustomer;
};

type GetOrderResult =
  | {
      success: true;
      id: number;
      orderNumber: number;
      name: string;
      email?: string;
      totalPrice: string;
      currency: string;
      financialStatus: string;
      fulfillmentStatus: string | null;
      createdAt: string;
      lineItems: Array<{
        id: number;
        title: string;
        quantity: number;
        price: string;
        sku?: string;
        variantId?: number;
        productId?: number;
      }>;
      shippingAddress?: {
        firstName?: string;
        lastName?: string;
        address1?: string;
        address2?: string;
        city?: string;
        province?: string;
        country?: string;
        zip?: string;
        phone?: string;
      };
      customer?: {
        id: number;
        email?: string;
        firstName?: string;
        lastName?: string;
      };
    }
  | { success: false; error: string };

export type GetOrderCoreInput = {
  orderId: string;
};

export type GetOrderInput = StepInput &
  GetOrderCoreInput & {
    integrationId?: string;
  };

function normalizeStoreDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function stepHandler(
  input: GetOrderCoreInput,
  credentials: ShopifyCredentials
): Promise<GetOrderResult> {
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
    const url = `https://${normalizedDomain}/admin/api/2024-01/orders/${input.orderId}.json`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { errors?: string };
      return {
        success: false,
        error: errorData.errors || `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { order: ShopifyOrder };
    const order = data.order;

    return {
      success: true,
      id: order.id,
      orderNumber: order.order_number,
      name: order.name,
      email: order.email,
      totalPrice: order.total_price,
      currency: order.currency,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      createdAt: order.created_at,
      lineItems: order.line_items.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        variantId: item.variant_id,
        productId: item.product_id,
      })),
      shippingAddress: order.shipping_address
        ? {
            firstName: order.shipping_address.first_name,
            lastName: order.shipping_address.last_name,
            address1: order.shipping_address.address1,
            address2: order.shipping_address.address2,
            city: order.shipping_address.city,
            province: order.shipping_address.province,
            country: order.shipping_address.country,
            zip: order.shipping_address.zip,
            phone: order.shipping_address.phone,
          }
        : undefined,
      customer: order.customer
        ? {
            id: order.customer.id,
            email: order.customer.email,
            firstName: order.customer.first_name,
            lastName: order.customer.last_name,
          }
        : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get order: ${getErrorMessage(error)}`,
    };
  }
}

export async function getOrderStep(
  input: GetOrderInput
): Promise<GetOrderResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}

export const _integrationType = "shopify";
