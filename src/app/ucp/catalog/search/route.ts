// POST /ucp/catalog/search: UCP catalog (search). Read-only, from the cached public catalog; never calls Dodo.
import { CAP_SEARCH, searchCatalog, searchRequestSchema } from "@/core/ucp-catalog";
import { publicBaseUrl } from "@/lib/public-url";
import { cachedPublicCatalog } from "../../../public-data";
import { handleCatalogRequest } from "../../../ucp-http";

export function POST(request: Request): Promise<Response> {
  return handleCatalogRequest(request, {
    capability: CAP_SEARCH,
    schema: searchRequestSchema,
    run: async (parsed) => searchCatalog({ baseUrl: publicBaseUrl(), catalog: await cachedPublicCatalog(), request: parsed }),
  });
}
