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
};

type OrderSummary = {
  id: number;
  orderNumber: number;
  name: string;
  email?: string;
  totalPrice: string;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

type ListOrdersResult =
  | {
      success: true;
      orders: OrderSummary[];
      count: number;
    }
  | { success: false; error: string };

export type ListOrdersCoreInput = {
  status?: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  createdAtMin?: string;
  createdAtMax?: string;
  limit?: number;
};

export type ListOrdersInput = StepInput &
  ListOrdersCoreInput & {
    integrationId?: string;
  };

function normalizeStoreDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function stepHandler(
  input: ListOrdersCoreInput,
  credentials: ShopifyCredentials
): Promise<ListOrdersResult> {
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
    const params = new URLSearchParams();

    if (input.status && input.status !== "any") {
      params.set("status", input.status);
    }

    if (input.financialStatus) {
      params.set("financial_status", input.financialStatus);
    }

    if (input.fulfillmentStatus) {
      params.set("fulfillment_status", input.fulfillmentStatus);
    }

    if (input.createdAtMin) {
      params.set("created_at_min", input.createdAtMin);
    }

    if (input.createdAtMax) {
      params.set("created_at_max", input.createdAtMax);
    }

    if (input.limit) {
      params.set("limit", String(input.limit));
    } else {
      params.set("limit", "50");
    }

    const url = `https://${normalizedDomain}/admin/api/2024-01/orders.json${
      params.toString() ? `?${params.toString()}` : ""
    }`;

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

    const data = (await response.json()) as { orders: ShopifyOrder[] };

    const orders: OrderSummary[] = data.orders.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      name: order.name,
      email: order.email,
      totalPrice: order.total_price,
      currency: order.currency,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      itemCount: order.line_items.reduce((sum, item) => sum + item.quantity, 0),
    }));

    return {
      success: true,
      orders,
      count: orders.length,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to list orders: ${getErrorMessage(error)}`,
    };
  }
}

export async function listOrdersStep(
  input: ListOrdersInput
): Promise<ListOrdersResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}

export const _integrationType = "shopify";
