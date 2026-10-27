// POST /ucp/catalog/lookup: UCP catalog (lookup). Read-only, from the cached public catalog; never calls Dodo.
import { CAP_LOOKUP, lookupCatalog, lookupRequestSchema } from "@/protocols/ucp/catalog";
import { publicBaseUrl } from "@/lib/public-url";
import { cachedPublicCatalog } from "../../../public-data";
import { handleCatalogRequest } from "../../../ucp-http";

export function POST(request: Request): Promise<Response> {
  return handleCatalogRequest(request, {
    capability: CAP_LOOKUP,
    schema: lookupRequestSchema,
    run: async (parsed) => lookupCatalog({ baseUrl: publicBaseUrl(), catalog: await cachedPublicCatalog(), request: parsed }),
  });
}
