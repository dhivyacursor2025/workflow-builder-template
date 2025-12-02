import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { getErrorMessage } from "@/lib/utils";
import type { ShopifyCredentials } from "../credentials";

type InventoryLevel = {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
};

type UpdateInventoryResult =
  | {
      success: true;
      inventoryItemId: number;
      locationId: number;
      available: number;
      previousQuantity: number;
    }
  | { success: false; error: string };

export type UpdateInventoryCoreInput = {
  inventoryItemId: string;
  locationId: string;
  adjustment: string;
};

export type UpdateInventoryInput = StepInput &
  UpdateInventoryCoreInput & {
    integrationId?: string;
  };

function normalizeStoreDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function stepHandler(
  input: UpdateInventoryCoreInput,
  credentials: ShopifyCredentials
): Promise<UpdateInventoryResult> {
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

  const adjustmentValue = Number.parseInt(input.adjustment, 10);
  if (Number.isNaN(adjustmentValue)) {
    return {
      success: false,
      error: "Adjustment must be a valid integer (e.g., 10 or -5)",
    };
  }

  try {
    const normalizedDomain = normalizeStoreDomain(storeDomain);

    // First, get the current inventory level
    const getUrl = `https://${normalizedDomain}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${input.inventoryItemId}&location_ids=${input.locationId}`;

    const getResponse = await fetch(getUrl, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!getResponse.ok) {
      const errorData = (await getResponse.json()) as { errors?: string };
      return {
        success: false,
        error:
          errorData.errors ||
          `Failed to get current inventory: HTTP ${getResponse.status}`,
      };
    }

    const getCurrentData = (await getResponse.json()) as {
      inventory_levels: InventoryLevel[];
    };

    if (getCurrentData.inventory_levels.length === 0) {
      return {
        success: false,
        error:
          "Inventory level not found for the specified item and location. Make sure the inventory item is stocked at this location.",
      };
    }

    const previousQuantity = getCurrentData.inventory_levels[0].available;

    // Now adjust the inventory
    const adjustUrl = `https://${normalizedDomain}/admin/api/2024-01/inventory_levels/adjust.json`;

    const response = await fetch(adjustUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        location_id: Number.parseInt(input.locationId, 10),
        inventory_item_id: Number.parseInt(input.inventoryItemId, 10),
        available_adjustment: adjustmentValue,
      }),
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

    const data = (await response.json()) as {
      inventory_level: InventoryLevel;
    };
    const level = data.inventory_level;

    return {
      success: true,
      inventoryItemId: level.inventory_item_id,
      locationId: level.location_id,
      available: level.available,
      previousQuantity,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update inventory: ${getErrorMessage(error)}`,
    };
  }
}

export async function updateInventoryStep(
  input: UpdateInventoryInput
): Promise<UpdateInventoryResult> {
  "use step";

  const credentials = input.integrationId
    ? await fetchCredentials(input.integrationId)
    : {};

  return withStepLogging(input, () => stepHandler(input, credentials));
}

export const _integrationType = "shopify";
