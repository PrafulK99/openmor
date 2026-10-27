// POST /ucp/catalog/product: UCP catalog (product). Read-only, from the cached public catalog; never calls Dodo.
import { CAP_LOOKUP, getCatalogProduct, productRequestSchema } from "@/protocols/ucp/catalog";
import { publicBaseUrl } from "@/lib/public-url";
import { cachedPublicCatalog } from "../../../public-data";
import { handleCatalogRequest } from "../../../ucp-http";

export function POST(request: Request): Promise<Response> {
  return handleCatalogRequest(request, {
    capability: CAP_LOOKUP,
    schema: productRequestSchema,
    run: async (parsed) => getCatalogProduct({ baseUrl: publicBaseUrl(), catalog: await cachedPublicCatalog(), request: parsed }),
  });
}
